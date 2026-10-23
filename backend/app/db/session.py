"""SQLAlchemy engine, session factory, and FastAPI session dependency."""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings


def create_database_engine(settings: Settings | None = None) -> Engine:
    """Create an engine with SQLite integrity safeguards and per-test isolation."""
    settings = settings or get_settings()
    url = make_url(settings.resolved_database_url)
    if url.get_backend_name() != "sqlite":
        raise ValueError("Only SQLite database URLs are supported")

    if url.database and url.database != ":memory:":
        Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)

    connect_args = {"check_same_thread": False} if url.get_backend_name() == "sqlite" else {}
    engine = create_engine(settings.resolved_database_url, connect_args=connect_args)

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return a factory with explicit transaction ownership (autocommit disabled)."""
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


engine: Engine | None = None
SessionLocal: sessionmaker[Session] | None = None


def _get_session_factory() -> sessionmaker[Session]:
    """Initialize the process engine only when the first request needs a session."""
    global engine, SessionLocal
    if SessionLocal is None:
        engine = create_database_engine()
        SessionLocal = create_session_factory(engine)
    return SessionLocal


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped session, rolling back an uncommitted failed request."""
    session = _get_session_factory()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
