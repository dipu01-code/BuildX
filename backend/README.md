# BUILDX backend

The backend is a Python 3.10+ FastAPI service. It uses SQLite and Alembic for project and plan persistence. Electron starts the local service and communicates with it through a narrow preload bridge. The OpenAI adapter handles connection checks and schema-constrained planning without reading workspace files.

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

The initial revision is intentionally empty. Phase 5 adds the projects table in a separate migration. From `backend/`, apply migrations with:

```sh
uv run alembic upgrade head
uv run alembic current
uv run alembic revision --autogenerate -m "describe schema change"
```

Review every generated revision before applying it; migrations are the source of schema changes, not `Base.metadata.create_all()`. Run the isolated database suite with `uv run pytest tests/test_database.py`. Tests use pytest temporary directories and never touch the configured application data directory. They also apply the migration twice to a fresh temporary database. For a one-off test database, set `BUILDX_DATABASE_URL=sqlite:////absolute/path/to/test.db` or `BUILDX_DATA_DIR` to a disposable directory.

SQLite is suitable for this single-user local-first foundation, but it serializes writes and is not a multi-process coordination or encryption layer. Backup/recovery policy, concurrency strategy, and Electron process lifecycle remain future design work.

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
| `BUILDX_AI_PROVIDER` | `openai` | The only provider implemented in Phase 8 |
| `BUILDX_AI_MODEL` | `gpt-5.4-mini` | OpenAI Responses API model identifier |
| `BUILDX_OPENAI_API_KEY` | unset | Optional OpenAI credential; backend only, never returned by the API |

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

Electron's main process applies Alembic migrations in the app's user data directory, launches the FastAPI service on an OS-assigned loopback port, and owns HTTP requests. The sandboxed renderer can call only the project operations exposed through preload IPC. Project `root_path` values are metadata only; Phase 5 does not inspect or modify the filesystem. A packaged build must include a compatible Python runtime and backend sources at `resources/backend` (or provide `BUILDX_BACKEND_DIR` during development).

## Projects (Phase 5)

The database-backed project endpoints are available under the configured API prefix (default `/api/v1`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/projects` | List projects, most recently updated first |
| `POST` | `/projects` | Create a project (`name`, optional metadata) |
| `GET` | `/projects/{project_id}` | Read one project |
| `PATCH` | `/projects/{project_id}` | Update supplied project metadata |
| `DELETE` | `/projects/{project_id}` | Delete the record only; local files remain untouched |

Project names are trimmed and must contain a non-whitespace character. Names are limited to 120 characters, descriptions to 2,000, project types to 60, and root paths to 2,048. The API stores a root path but does not validate or access that path; secure directory handling belongs to Phase 6. Migrations run before the Electron-owned backend starts.

## Workspace files (Phase 6)

Filesystem operations are owned by Electron's main process, not FastAPI. Electron obtains the stored root path and requires that the same canonical directory was confirmed through its native folder picker during the current app run; a path in the database alone is not authorization. Users confirm folders again after restarting BUILDX. The renderer has no direct filesystem or Node.js access. Symbolic links within project trees are shown as blocked entries and cannot be traversed. File previews accept UTF-8 text up to 1 MiB; they reject binary, invalid UTF-8, and oversized files. Path validation reduces traversal risks but does not claim to close every race with another local process mutating the same directory.

## AI provider connection (Phase 8)

The only implemented provider is OpenAI through its official Python SDK and Responses API. For local setup, run `cp .env.example .env` from `backend/`, add your key to `BUILDX_OPENAI_API_KEY`, and restart BUILDX. Keep the key out of source control. The renderer never reads or submits the key. `BUILDX_AI_MODEL` selects a validated model identifier and defaults to `gpt-5.4-mini`; there is no user-controlled API endpoint.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/ai/status` | Return provider, model, credential-available boolean, and `not_tested` or `missing_credentials`; this does not test reachability |
| `POST` | `/ai/test-connection` | Send one fixed, short request with a bounded timeout; sends no project data and stores no response |

An unconfigured status is returned without failing backend startup. Test failures use stable categories (`configuration_error`, `authentication_error`, `rate_limited`, `timeout`, `network_error`, `malformed_response`, and `provider_error`) with sanitized messages. The test request disables provider response storage, is not persisted locally, and may incur a small API charge when credentials are configured. Automated tests use fake providers and never call the real API.

Example unconfigured status:

```json
{"provider_configured":false,"provider_id":"openai","model_id":"gpt-5.4-mini","credential_available":false,"connection_status":"missing_credentials"}
```

Example successful connection test:

```json
{"success":true,"provider_id":"openai","model_id":"gpt-5.4-mini","response_text":"BUILDX connection verified.","duration_ms":142,"error_category":null,"message":null}
```

## Project planning (Phase 9)

Project plans are generated through the Phase 8 provider adapter, returned as unsaved drafts, and validated with bounded Pydantic schemas before reaching Electron. `POST /projects/{project_id}/plans/generate` sends only the project brief and optional planning preferences; generation does not persist a plan. `POST`, `GET`, `PATCH`, and `DELETE` at `/projects/{project_id}/plans` manage approved plan records. Plan JSON is associated with the project by a cascading foreign key in migration `0003_project_plans`; plan deletion never touches project files. Provider output and saved edits must have valid dependency references and an acyclic task dependency graph.
