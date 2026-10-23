# BUILDX backend

The backend is a Python 3.10+ FastAPI service. Phase 3 provides the API foundation only; it does not start automatically with Electron and does not yet access a database, projects, files, or AI providers.

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
