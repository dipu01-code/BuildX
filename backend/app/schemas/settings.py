"""Typed settings schemas for the centralized settings system.

Preferences are non-secret user configuration persisted in the local SQLite
database. Sensitive credentials (for example BUILDX_OPENAI_API_KEY) remain in
backend environment configuration and are never exposed through these schemas.
"""

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SETTINGS_VERSION = 1

Theme = Literal["system", "light", "dark"]
Uidensity = Literal["compact", "comfortable"]
StartupBehavior = Literal["show_home", "open_last_project"]


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class GeneralSettings(BaseModel):
    """Application startup and project-directory preferences."""

    startup_behavior: StartupBehavior = "show_home"
    default_project_directory: Optional[str] = Field(default=None, max_length=4096)
    confirm_destructive_actions: bool = True


class AppearanceSettings(BaseModel):
    """Visual preferences persisted and applied by the renderer."""

    theme: Theme = "system"
    ui_density: Uidensity = "comfortable"


class EditorSettings(BaseModel):
    """Editor behavior preferences. The CodeMirror editor applies these where supported."""

    font_size: int = Field(default=12, ge=8, le=72)
    tab_size: int = Field(default=2, ge=1, le=16)
    word_wrap: bool = True
    minimap: bool = False
    auto_save: bool = False


class AIProviderSettings(BaseModel):
    """AI provider selection metadata. The actual credential stays in env config."""

    provider: Literal["openai"] = "openai"
    model: str = Field(default="gpt-5.4-mini", min_length=1, max_length=128)

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not value.strip() or not all(
            character.isalnum() or character in ".:_-" for character in value
        ):
            raise ValueError("AI model must be a provider model identifier")
        return value


class TerminalSettings(BaseModel):
    """Terminal preferences. Command approval from Phase 13 is always enforced."""

    default_working_directory: Optional[str] = Field(default=None, max_length=4096)
    output_retention_limit: int = Field(default=20, ge=1, le=200)
    timeout_ms: int = Field(default=300000, ge=1000, le=1800000)


class ProjectContextSettings(BaseModel):
    """Indexing limits. Phase 10 security boundaries are never bypassed."""

    max_file_size_mb: int = Field(default=1, ge=1, le=1024)
    indexing_enabled: bool = True


class PrivacySettings(BaseModel):
    """Privacy controls. Telemetry is opt-in only and off by default."""

    telemetry_enabled: bool = False


class AppSettings(BaseModel):
    """Complete typed settings document."""

    model_config = ConfigDict(extra="forbid")

    version: int = SETTINGS_VERSION
    general: GeneralSettings = Field(default_factory=GeneralSettings)
    appearance: AppearanceSettings = Field(default_factory=AppearanceSettings)
    editor: EditorSettings = Field(default_factory=EditorSettings)
    ai_provider: AIProviderSettings = Field(default_factory=AIProviderSettings)
    terminal: TerminalSettings = Field(default_factory=TerminalSettings)
    project_context: ProjectContextSettings = Field(default_factory=ProjectContextSettings)
    privacy: PrivacySettings = Field(default_factory=PrivacySettings)

    def to_stored_dict(self) -> dict:
        """Serialize for storage, excluding secrets (none are stored here)."""
        return self.model_dump(mode="json")

    @classmethod
    def from_stored(cls, data: dict) -> "AppSettings":
        """Rebuild typed settings from a stored document, tolerating older versions."""

        stored_version = data.get("version", SETTINGS_VERSION)
        if stored_version != SETTINGS_VERSION:
            # Future/older versions: keep known sections, drop unknown keys via extra="forbid".
            data = {**data, "version": SETTINGS_VERSION}
        return cls.model_validate(data)


class SettingsPatch(BaseModel):
    """Partial settings update. Unset fields are preserved."""

    model_config = ConfigDict(extra="forbid")

    general: Optional[GeneralSettings] = None
    appearance: Optional[AppearanceSettings] = None
    editor: Optional[EditorSettings] = None
    ai_provider: Optional[AIProviderSettings] = None
    terminal: Optional[TerminalSettings] = None
    project_context: Optional[ProjectContextSettings] = None
    privacy: Optional[PrivacySettings] = None

    @field_validator("general", "appearance", "editor", "ai_provider", "terminal", "project_context", "privacy", mode="before")
    @classmethod
    def coerce_empty_to_none(cls, value):
        if value == {}:
            return None
        return value

    def model_fields_set_nonempty(self) -> bool:
        return bool(self.model_fields_set)


class SettingsRead(BaseModel):
    """Settings returned to the caller. No secrets are ever included."""

    model_config = ConfigDict(from_attributes=True)

    version: int
    general: GeneralSettings
    appearance: AppearanceSettings
    editor: EditorSettings
    ai_provider: AIProviderSettings
    terminal: TerminalSettings
    project_context: ProjectContextSettings
    privacy: PrivacySettings

    @classmethod
    def from_settings(cls, settings: AppSettings) -> "SettingsRead":
        return cls(
            version=settings.version,
            general=settings.general,
            appearance=settings.appearance,
            editor=settings.editor,
            ai_provider=settings.ai_provider,
            terminal=settings.terminal,
            project_context=settings.project_context,
            privacy=settings.privacy,
        )


class SettingsReset(BaseModel):
    """Confirmation that settings were reset to defaults."""

    version: int
    message: str = "Settings reset to defaults"


# ---------------------------------------------------------------------------
# Operational health dashboard schemas
# ---------------------------------------------------------------------------

HealthState = Literal["healthy", "degraded", "unavailable", "not_configured", "unknown"]


class ComponentHealth(BaseModel):
    """Health of one operational component."""

    name: str
    status: HealthState
    last_check: Optional[str] = None
    message: str
    retry_available: bool = False


class HealthDashboard(BaseModel):
    """Aggregate operational status for the settings health dashboard."""

    model_config = ConfigDict(extra="forbid")

    overall: HealthState
    components: list[ComponentHealth]
    checked_at: str
