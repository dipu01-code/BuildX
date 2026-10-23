# BUILDX backend

The backend is a Python 3.10+ FastAPI service. Phase 4 adds SQLite persistence and Alembic migration infrastructure. The service does not start automatically with Electron and does not yet implement project, file, or AI workflows.

## Setup and run

Install [uv](https://docs.astral.sh/uv/), then from this directory:

```sh
uv sync
uv run python -m app
```

The server binds to loopback and asks the operating system for an available port by default. Its first structured log line contains the actual address, for example `{"timestamp":"…","level":"info","logger":"buildx.server","message":"Backend listening","host":"127.0.0.1","port":54321}`. Set `BUILDX_PORT=8765` to request a specific available port; startup fails clearly if that port is occupied. `BUILDX_HOST` accepts only `localhost` or a loopback IP address.

Open the `/docs` endpoint on the address printed at startup for interactive API docs. Set `BUILDX_ENVIRONMENT=production` to disable `/docs`, `/redoc`, and `/openapi.json`.

Run tests with:

```sh
uv run pytest
```

## Database

`app/db/base.py` owns the shared declarative base, `app/db/models/` registers approved ORM models, and `app/db/session.py` creates SQLite engines and request-scoped sessions. SQLite foreign-key checks are enabled on each connection. Routes own successful transaction commits; the dependency rolls back an active transaction when a handler raises and always closes the session. No tables are created implicitly at application startup.

The default database is `buildx.db` in the OS-specific persistent user data directory: macOS `~/Library/Application Support/BUILDX`, Windows `%APPDATA%/BUILDX`, and Linux `$XDG_DATA_HOME/buildx` (default `~/.local/share/buildx`). Set `BUILDX_DATA_DIR` to override that directory; packaged Electron should pass `app.getPath('userData')` as this variable to the backend process. Alternatively, `BUILDX_DATABASE_URL` accepts a SQLite URL and takes precedence. Only SQLite URLs are supported. SQLite is not an encryption mechanism; use OS file permissions and future approved secret-storage design for sensitive data.

The initial revision is intentionally empty because no domain schema was approved in Phase 0. It creates only Alembic's `alembic_version` tracking table. From `backend/`, initialize/apply migrations with:

```sh
uv run alembic upgrade head
uv run alembic current
uv run alembic revision --autogenerate -m "describe schema change"
```

Review every generated revision before applying it; migrations are the source of schema changes, not `Base.metadata.create_all()`. Run the isolated database suite with `uv run pytest tests/test_database.py`. Tests use pytest temporary directories and never touch the configured application data directory. They also apply the migration twice to a fresh temporary database. For a one-off test database, set `BUILDX_DATABASE_URL=sqlite:////absolute/path/to/test.db` or `BUILDX_DATA_DIR` to a disposable directory.

SQLite is suitable for this single-user local-first foundation, but it serializes writes and is not a multi-process coordination or encryption layer. Backup/recovery policy, domain tables, concurrency strategy, and Electron process lifecycle remain future design work.

## Configuration

Settings use the `BUILDX_` environment prefix. `.env` is read for local development and is ignored by Git. The supported values are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BUILDX_APP_NAME` | `BUILDX API` | API service name in metadata and health response |
| `BUILDX_APP_VERSION` | `0.1.0` | API version |
| `BUILDX_ENVIRONMENT` | `development` | `development`, `test`, or `production` |
| `BUILDX_API_PREFIX` | `/api/v1` | Versioned route prefix |
| `BUILDX_HOST` | `127.0.0.1` | Loopback bind address |
| `BUILDX_PORT` | `0` | Port; zero requests an OS-assigned available port |
| `BUILDX_DATA_DIR` | OS-specific user data directory | Directory for persistent local application data; Electron should pass `app.getPath('userData')` |
| `BUILDX_DATABASE_URL` | SQLite file under the data directory | Optional explicit SQLite database URL |

Invalid values fail settings validation instead of silently falling back.

## API

### `GET /api/v1/health`

Confirms that the API process is serving requests. It deliberately does not claim database or AI-provider readiness.

```json
{"status":"ok","service":"BUILDX API","version":"0.1.0"}
```

Errors use one JSON envelope. Validation failures return HTTP 422 and include safe field locations and messages without echoing rejected values. Unhandled errors return HTTP 500 with a generic message; internal exception details are not sent to clients.

```json
{"error":{"code":"VALIDATION_ERROR","message":"The request is invalid","details":[]}}
```

## Electron communication contract

There is no backend communication contract in the current Electron application, so Phase 3 does not modify the main process or renderer bridge. When backend process management is approved, Electron's main process should select an available loopback port, pass it as `BUILDX_PORT` (or use port `0` and read the backend's structured startup line), and own the HTTP client boundary. The sandboxed renderer should continue to communicate through narrowly scoped preload IPC rather than receive unrestricted Node.js, shell, or direct backend access. CORS remains disabled because no browser-origin API requests are currently required. Per-launch request authorization and packaged process lifecycle need an approved follow-up design before exposing API operations.
