"""Validated AI-generated and user-approved project plans."""

from datetime import datetime
from typing import Annotated
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlanModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Criterion = Annotated[str, Field(min_length=1, max_length=500)]
PlanningLine = Annotated[str, Field(min_length=1, max_length=500)]
UserGroup = Annotated[str, Field(min_length=1, max_length=160)]


class PlanRequirement(PlanModel):
    id: str = Field(pattern=r"^req_[a-zA-Z0-9_-]{1,56}$")
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1500)
    priority: Literal["must", "should", "could"]
    acceptance_criteria: list[Criterion] = Field(min_length=1, max_length=10)
    dependencies: list[str] = Field(max_length=30)


class PlanTask(PlanModel):
    id: str = Field(pattern=r"^task_[a-zA-Z0-9_-]{1,56}$")
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1500)
    rationale: str = Field(min_length=1, max_length=1000)
    priority: Literal["must", "should", "could"]
    estimated_effort: str | None = Field(max_length=100, description="Rough estimate only; use null when unreliable.")
    dependencies: list[str] = Field(max_length=30)
    acceptance_criteria: list[Criterion] = Field(min_length=1, max_length=10)
    suggested_milestone: str | None = Field(max_length=160)

    @field_validator("estimated_effort", mode="before")
    @classmethod
    def label_estimates_as_rough(cls, value: str | None) -> str | None:
        if value is None or not str(value).strip():
            return None
        value = str(value).strip()
        return value if "rough estimate" in value.casefold() else f"{value} (rough estimate)"


class PlanMilestone(PlanModel):
    id: str = Field(pattern=r"^mile_[a-zA-Z0-9_-]{1,56}$")
    title: str = Field(min_length=1, max_length=160)
    goal: str = Field(min_length=1, max_length=1000)
    tasks: list[PlanTask] = Field(min_length=1, max_length=30)
    completion_criteria: list[Criterion] = Field(min_length=1, max_length=10)


class StackRecommendation(PlanModel):
    technology: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)


class PlanRisk(PlanModel):
    risk: str = Field(min_length=1, max_length=500)
    mitigation: str = Field(min_length=1, max_length=500)


class PlanRecommendations(PlanModel):
    recommended_stack: list[StackRecommendation] = Field(max_length=20)
    architecture: str = Field(min_length=1, max_length=4000)
    risks: list[PlanRisk] = Field(max_length=20)
    testing_strategy: list[PlanningLine] = Field(min_length=1, max_length=20)
    security_considerations: list[PlanningLine] = Field(min_length=1, max_length=20)


class PlanContent(PlanModel):
    project_title: str = Field(min_length=1, max_length=160)
    problem_statement: str = Field(min_length=1, max_length=2000)
    intended_users: list[UserGroup] = Field(min_length=1, max_length=20)
    main_objectives: list[PlanningLine] = Field(min_length=1, max_length=20)
    assumptions: list[PlanningLine] = Field(max_length=20)
    out_of_scope: list[PlanningLine] = Field(max_length=20)
    requirements: list[PlanRequirement] = Field(min_length=1, max_length=50)
    milestones: list[PlanMilestone] = Field(min_length=1, max_length=20)
    recommendations: PlanRecommendations

    @model_validator(mode="after")
    def validate_references_and_cycles(self) -> "PlanContent":
        if len(self.model_dump_json().encode("utf-8", errors="replace")) > 180_000:
            raise ValueError("A plan cannot exceed 180 KB")
        requirement_ids = [item.id for item in self.requirements]
        milestones = [item.id for item in self.milestones]
        tasks = [task for milestone in self.milestones for task in milestone.tasks]
        task_ids = [task.id for task in tasks]
        all_ids = requirement_ids + milestones + task_ids
        if len(set(all_ids)) != len(all_ids):
            raise ValueError("Plan identifiers must be unique")
        requirement_set = set(requirement_ids)
        task_set = set(task_ids)
        for requirement in self.requirements:
            invalid = set(requirement.dependencies) - requirement_set
            if invalid:
                raise ValueError("Requirement dependencies must reference requirements in this plan")
        graph: dict[str, set[str]] = {}
        for task in tasks:
            invalid = set(task.dependencies) - task_set
            if invalid:
                raise ValueError("Task dependencies must reference tasks in this plan")
            if task.id in task.dependencies:
                raise ValueError("A task cannot depend on itself")
            graph[task.id] = set(task.dependencies)
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(task_id: str) -> None:
            if task_id in visiting:
                raise ValueError("Task dependencies cannot contain a cycle")
            if task_id in visited:
                return
            visiting.add(task_id)
            for dependency in graph[task_id]:
                visit(dependency)
            visiting.remove(task_id)
            visited.add(task_id)

        for task_id in graph:
            visit(task_id)
        if len(tasks) > 120:
            raise ValueError("A plan cannot contain more than 120 tasks")
        return self


class PlanGenerationRequest(PlanModel):
    project_brief: str = Field(min_length=1, max_length=12000)
    constraints: str | None = Field(default=None, max_length=4000)
    preferred_technology_stack: list[str] = Field(default_factory=list, max_length=20)
    experience_level: Literal["beginner", "intermediate", "advanced"] | None = None
    delivery_priorities: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("preferred_technology_stack")
    @classmethod
    def bound_stack_items(cls, values: list[str]) -> list[str]:
        if any(len(item) > 120 for item in values):
            raise ValueError("Each technology preference must be at most 120 characters")
        return [item.strip() for item in values if item.strip()]

    @field_validator("delivery_priorities")
    @classmethod
    def bound_priority_items(cls, values: list[str]) -> list[str]:
        if any(len(item) > 200 for item in values):
            raise ValueError("Each delivery priority must be at most 200 characters")
        return [item.strip() for item in values if item.strip()]

    @field_validator("project_brief")
    @classmethod
    def brief_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Project brief must contain non-whitespace text")
        return value.strip()


class PlanCreate(PlanModel):
    plan: PlanContent


class PlanUpdate(PlanModel):
    project_title: str | None = Field(default=None, min_length=1, max_length=160)
    problem_statement: str | None = Field(default=None, min_length=1, max_length=2000)
    intended_users: list[str] | None = Field(default=None, min_length=1, max_length=20)
    main_objectives: list[str] | None = Field(default=None, min_length=1, max_length=20)
    assumptions: list[str] | None = Field(default=None, max_length=20)
    out_of_scope: list[str] | None = Field(default=None, max_length=20)
    requirements: list[PlanRequirement] | None = Field(default=None, min_length=1, max_length=50)
    milestones: list[PlanMilestone] | None = Field(default=None, min_length=1, max_length=20)
    recommendations: PlanRecommendations | None = None

    @model_validator(mode="after")
    def has_changes(self) -> "PlanUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one plan field must be provided")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Plan fields cannot be null")
        return self


class SavedPlan(PlanModel):
    id: UUID
    project_id: UUID
    plan: PlanContent
    created_at: datetime
    updated_at: datetime
