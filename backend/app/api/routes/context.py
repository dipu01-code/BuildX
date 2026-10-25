"""Project-scoped local context index, progress, and lexical search APIs."""

from datetime import datetime, timedelta, timezone
import hashlib
import logging
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.context.indexing import chunk_text, make_excerpt, normalize_text, query_terms, score_chunk
from app.db.models import Project, ProjectIndexJob, ProjectIndexedChunk, ProjectIndexedFile
from app.db.models.project import utc_now
from app.db.session import get_db
from app.schemas.context import (
    ContextChunkResponse,
    ContextSearchResponse,
    ContextSearchResult,
    IndexCompleteRequest,
    IndexFilesRequest,
    IndexFailureRequest,
    IndexProgressRequest,
    IndexRefreshAccepted,
    IndexedFileMetadata,
    IndexedFilesPage,
    IndexStatus,
)

logger = logging.getLogger("buildx.context")
router = APIRouter(prefix="/projects/{project_id}/context", tags=["project context"])
MAX_FILE_BYTES = 1_048_576
MAX_FILES_PER_PROJECT = 5000
MAX_BATCH_BYTES = 8 * MAX_FILE_BYTES
MAX_PROJECT_BYTES = 25 * 1024 * 1024
MAX_STAGED_FILES = MAX_FILES_PER_PROJECT * 2
MAX_STAGED_BYTES = MAX_PROJECT_BYTES * 2


def _project_or_404(db: Session, project_id: UUID) -> None:
    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


def _job_or_404(db: Session, project_id: UUID) -> ProjectIndexJob:
    job = db.scalar(select(ProjectIndexJob).where(ProjectIndexJob.project_id == project_id))
    if job is None or job.state != "indexing":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No active indexing job exists")
    return job


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _status(db: Session, project_id: UUID, job: ProjectIndexJob | None = None) -> IndexStatus:
    file_count = db.scalar(
        select(func.count(ProjectIndexedFile.id)).where(ProjectIndexedFile.project_id == project_id)
    ) or 0
    chunk_count = db.scalar(
        select(func.count(ProjectIndexedChunk.id)).where(ProjectIndexedChunk.project_id == project_id)
    ) or 0
    return IndexStatus(
        project_id=project_id,
        state=job.state if job else "not_indexed",
        discovered_count=job.discovered_count if job else 0,
        processed_count=job.processed_count if job else 0,
        skipped_count=job.skipped_count if job else 0,
        indexed_file_count=file_count,
        chunk_count=chunk_count,
        skip_reasons=job.skip_reasons if job else {},
        errors=job.errors if job else [],
        started_at=_aware(job.started_at) if job else None,
        completed_at=_aware(job.completed_at) if job else None,
        updated_at=_aware(job.updated_at) if job else None,
    )


def _bounded_request(request: Request) -> None:
    header = request.headers.get("content-length")
    if header and (not header.isdigit() or int(header) > MAX_BATCH_BYTES + 256_000):
        raise HTTPException(status_code=413, detail="The indexing batch is too large")


def _commit(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def _merge_errors(existing: list[dict[str, str]], incoming: list[dict[str, str]]) -> list[dict[str, str]]:
    result = list(existing)
    seen = {(item.get("path"), item.get("message")) for item in result}
    for item in incoming:
        if hasattr(item, "model_dump"):
            item = item.model_dump()
        safe_item = {"path": item.get("path", "")[:2048], "message": item.get("message", "Indexing failed")[:240]}
        key = (safe_item["path"], safe_item["message"])
        if key not in seen and len(result) < 100:
            result.append(safe_item)
            seen.add(key)
    return result


@router.post("/index/refresh", response_model=IndexRefreshAccepted, status_code=status.HTTP_202_ACCEPTED)
def start_index_refresh(project_id: UUID, db: Session = Depends(get_db)) -> IndexRefreshAccepted:
    _project_or_404(db, project_id)
    now = utc_now()
    job = db.scalar(select(ProjectIndexJob).where(ProjectIndexJob.project_id == project_id))
    if job is not None and job.state == "indexing":
        updated = _aware(job.updated_at)
        if updated and now - updated < timedelta(minutes=10):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This project is already being indexed")
    if job is None:
        job = ProjectIndexJob(
            id=uuid4(), project_id=project_id, state="indexing", discovered_count=0, processed_count=0,
            skipped_count=0, skip_reasons={}, errors=[], started_at=now, completed_at=None, updated_at=now,
        )
        db.add(job)
    else:
        job.state = "indexing"
        job.discovered_count = 0
        job.processed_count = 0
        job.skipped_count = 0
        job.skip_reasons = {}
        job.errors = []
        job.started_at = now
        job.completed_at = None
        job.updated_at = now
    _commit(db)
    return IndexRefreshAccepted(project_id=project_id, state="indexing", started_at=now)


@router.put("/index/files", response_model=IndexStatus)
def upload_index_files(
    project_id: UUID, payload: IndexFilesRequest, request: Request, db: Session = Depends(get_db)
) -> IndexStatus:
    _bounded_request(request)
    _project_or_404(db, project_id)
    job = _job_or_404(db, project_id)
    paths = [item.relative_path for item in payload.files]
    if len(paths) != len(set(paths)):
        raise HTTPException(status_code=422, detail="An indexing batch cannot repeat file paths")
    total_bytes = 0
    project_bytes = db.scalar(select(func.coalesce(func.sum(ProjectIndexedFile.file_size), 0)).where(
        ProjectIndexedFile.project_id == project_id
    )) or 0
    project_file_count = db.scalar(select(func.count(ProjectIndexedFile.id)).where(
        ProjectIndexedFile.project_id == project_id
    )) or 0
    now = utc_now()
    for item in payload.files:
        existing = db.scalar(select(ProjectIndexedFile).where(
            ProjectIndexedFile.project_id == project_id,
            ProjectIndexedFile.relative_path == item.relative_path,
        ))
        if item.content is None:
            if existing is None or existing.content_hash != item.content_hash:
                raise HTTPException(status_code=409, detail="A changed file must include its text content")
            if existing.file_size != item.file_size:
                raise HTTPException(status_code=422, detail="Unchanged file metadata does not match its stored content")
            existing.file_size = item.file_size
            existing.modified_at_ms = item.modified_at_ms
            continue
        encoded = item.content.encode("utf-8")
        total_bytes += len(encoded)
        if len(encoded) > MAX_FILE_BYTES or len(encoded) != item.file_size:
            raise HTTPException(status_code=413, detail="An indexed file exceeds the supported size limit")
        actual_hash = hashlib.sha256(encoded).hexdigest()
        if actual_hash != item.content_hash:
            raise HTTPException(status_code=422, detail="The file content hash does not match its metadata")
        if b"\x00" in encoded:
            raise HTTPException(status_code=422, detail="Binary files cannot be indexed")
        if existing is not None and existing.content_hash == item.content_hash:
            existing.file_size = item.file_size
            existing.modified_at_ms = item.modified_at_ms
            continue
        next_project_bytes = project_bytes - (existing.file_size if existing is not None else 0) + item.file_size
        if next_project_bytes > MAX_STAGED_BYTES:
            raise HTTPException(status_code=413, detail="The project refresh exceeds the temporary 50 MiB storage limit")
        if existing is None and project_file_count >= MAX_STAGED_FILES:
            raise HTTPException(status_code=413, detail="The project exceeds the 5,000-file indexing limit")
        is_new_file = existing is None
        normalized = normalize_text(item.content)
        line_chunks = chunk_text(normalized)
        if existing is None:
            existing = ProjectIndexedFile(
                id=uuid4(), project_id=project_id, relative_path=item.relative_path,
                content_hash=item.content_hash, file_size=item.file_size,
                modified_at_ms=item.modified_at_ms, indexed_at=now,
            )
            db.add(existing)
            db.flush()
        else:
            db.query(ProjectIndexedChunk).filter(ProjectIndexedChunk.file_id == existing.id).delete(synchronize_session=False)
            existing.content_hash = item.content_hash
            existing.file_size = item.file_size
            existing.modified_at_ms = item.modified_at_ms
            existing.indexed_at = now
        project_bytes = next_project_bytes
        if is_new_file:
            project_file_count += 1
        for chunk_index, chunk in enumerate(line_chunks):
            content = str(chunk["content"])
            db.add(ProjectIndexedChunk(
                id=uuid5(NAMESPACE_URL, f"buildx-context:{project_id}:{item.relative_path}:{chunk_index}:{hashlib.sha256(content.encode('utf-8')).hexdigest()}"),
                project_id=project_id, file_id=existing.id,
                relative_path=item.relative_path, chunk_index=chunk_index, content=content,
                start_line=int(chunk["start_line"]), end_line=int(chunk["end_line"]),
                content_hash=item.content_hash, chunk_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                indexed_at=now,
            ))
    if total_bytes > MAX_BATCH_BYTES:
        raise HTTPException(status_code=413, detail="The indexing batch exceeds its byte limit")
    job.updated_at = now
    _commit(db)
    return _status(db, project_id, job)


@router.patch("/index/progress", response_model=IndexStatus)
def report_index_progress(
    project_id: UUID, payload: IndexProgressRequest, db: Session = Depends(get_db)
) -> IndexStatus:
    _project_or_404(db, project_id)
    job = _job_or_404(db, project_id)
    if payload.processed_count > payload.discovered_count:
        raise HTTPException(status_code=422, detail="Processed files cannot exceed discovered files")
    job.discovered_count = payload.discovered_count
    job.processed_count = payload.processed_count
    job.skipped_count = payload.skipped_count
    job.skip_reasons = payload.skip_reasons
    job.errors = _merge_errors(job.errors, payload.errors)
    job.updated_at = utc_now()
    _commit(db)
    return _status(db, project_id, job)


@router.post("/index/complete", response_model=IndexStatus)
def complete_index_refresh(
    project_id: UUID, payload: IndexCompleteRequest, db: Session = Depends(get_db)
) -> IndexStatus:
    _project_or_404(db, project_id)
    job = _job_or_404(db, project_id)
    if payload.processed_count > payload.discovered_count:
        raise HTTPException(status_code=422, detail="Processed files cannot exceed discovered files")
    keep_paths = set(payload.eligible_paths) | set(payload.failed_paths)
    if not payload.incomplete:
        for record in db.scalars(select(ProjectIndexedFile).where(ProjectIndexedFile.project_id == project_id)):
            preserve = record.relative_path in keep_paths or any(
                prefix and record.relative_path.startswith(f"{prefix}/") for prefix in payload.failed_paths
            ) or "" in payload.failed_paths
            if not preserve:
                db.delete(record)
    db.flush()
    final_file_count = db.scalar(select(func.count(ProjectIndexedFile.id)).where(
        ProjectIndexedFile.project_id == project_id
    )) or 0
    final_bytes = db.scalar(select(func.coalesce(func.sum(ProjectIndexedFile.file_size), 0)).where(
        ProjectIndexedFile.project_id == project_id
    )) or 0
    if final_file_count > MAX_FILES_PER_PROJECT or final_bytes > MAX_PROJECT_BYTES:
        raise HTTPException(status_code=413, detail="The completed index exceeds its 5,000-file or 25 MiB limit")
    job.discovered_count = payload.discovered_count
    job.processed_count = payload.processed_count
    job.skipped_count = payload.skipped_count
    job.skip_reasons = payload.skip_reasons
    job.errors = _merge_errors(job.errors, payload.errors)
    problem_reasons = {"file_too_large", "project_size_limit", "file_limit", "entry_limit", "invalid_text", "binary_file", "unreadable", "file_changed", "upload_failed"}
    has_problem = bool(job.errors or problem_reasons.intersection(job.skip_reasons))
    has_problem = has_problem or payload.incomplete
    indexed_count = final_file_count
    job.state = "failed" if has_problem and indexed_count == 0 else "partial" if has_problem else "up_to_date"
    job.completed_at = utc_now()
    job.updated_at = job.completed_at
    _commit(db)
    logger.info("Project context indexing completed", extra={
        "project_id": str(project_id), "state": job.state, "indexed_files": indexed_count,
        "skipped_count": job.skipped_count, "error_count": len(job.errors),
    })
    return _status(db, project_id, job)


@router.post("/index/fail", response_model=IndexStatus)
def fail_index_refresh(
    project_id: UUID, payload: IndexFailureRequest, db: Session = Depends(get_db)
) -> IndexStatus:
    _project_or_404(db, project_id)
    job = _job_or_404(db, project_id)
    job.state = "failed"
    job.errors = _merge_errors(job.errors, [{"path": "", "message": payload.message}])
    job.completed_at = utc_now()
    job.updated_at = job.completed_at
    _commit(db)
    return _status(db, project_id, job)


@router.get("/status", response_model=IndexStatus)
def get_index_status(project_id: UUID, db: Session = Depends(get_db)) -> IndexStatus:
    _project_or_404(db, project_id)
    job = db.scalar(select(ProjectIndexJob).where(ProjectIndexJob.project_id == project_id))
    return _status(db, project_id, job)


@router.get("/files", response_model=IndexedFilesPage)
def list_indexed_files(
    project_id: UUID,
    offset: int = Query(default=0, ge=0, le=5000),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> IndexedFilesPage:
    _project_or_404(db, project_id)
    total = db.scalar(select(func.count(ProjectIndexedFile.id)).where(ProjectIndexedFile.project_id == project_id)) or 0
    rows = db.scalars(
        select(ProjectIndexedFile).where(ProjectIndexedFile.project_id == project_id)
        .order_by(ProjectIndexedFile.relative_path).offset(offset).limit(limit)
    ).all()
    return IndexedFilesPage(
        files=[IndexedFileMetadata.model_validate(row, from_attributes=True) for row in rows],
        total=total, offset=offset, limit=limit,
    )


@router.get("/files/chunks", response_model=list[ContextChunkResponse])
def get_indexed_file_chunks(
    project_id: UUID,
    relative_path: str = Query(min_length=1, max_length=2048),
    db: Session = Depends(get_db),
) -> list[ContextChunkResponse]:
    _project_or_404(db, project_id)
    from app.schemas.context import validate_relative_path
    try:
        validate_relative_path(relative_path)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="A valid project-relative path is required") from error
    rows = db.scalars(select(ProjectIndexedChunk).where(
        ProjectIndexedChunk.project_id == project_id,
        ProjectIndexedChunk.relative_path == relative_path,
    ).order_by(ProjectIndexedChunk.chunk_index).limit(1000)).all()
    return [ContextChunkResponse.model_validate(row, from_attributes=True) for row in rows]


@router.get("/search", response_model=ContextSearchResponse)
def search_project_context(
    project_id: UUID,
    q: str = Query(min_length=2, max_length=300),
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
) -> ContextSearchResponse:
    _project_or_404(db, project_id)
    try:
        terms = query_terms(q)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    rows = db.scalars(select(ProjectIndexedChunk).where(
        ProjectIndexedChunk.project_id == project_id
    ).order_by(ProjectIndexedChunk.relative_path, ProjectIndexedChunk.chunk_index).execution_options(yield_per=256))
    ranked: list[tuple[float, str, int, str, str, int, int]] = []
    seen_hashes: set[str] = set()
    for row in rows:
        if row.chunk_hash in seen_hashes:
            continue
        score = score_chunk(row.content, q, terms, row.relative_path)
        if score <= 0:
            continue
        seen_hashes.add(row.chunk_hash)
        ranked.append((score, row.relative_path, row.chunk_index, row.content, row.chunk_hash, row.start_line, row.end_line))
    ranked.sort(key=lambda result: (-result[0], result[1], result[2]))
    results = [ContextSearchResult(
        relative_path=path, start_line=start_line, end_line=end_line,
        excerpt=make_excerpt(content, terms), score=score, chunk_hash=chunk_hash,
    ) for score, path, _chunk_index, content, chunk_hash, start_line, end_line in ranked[:limit]]
    return ContextSearchResponse(query=q, results=results, total=len(results))
