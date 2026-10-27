# BUILDX

BUILDX is a local-first desktop workspace for organizing development projects, browsing and editing project files, planning work, and asking an AI assistant questions grounded in a local project index.

## Current capabilities

- Create and manage project records stored in a local SQLite database.
- Associate a project with a folder selected through the native folder picker; browse files and edit supported UTF-8 text files in the desktop workspace.
- Draft, edit, save, and reopen project plans. Plans are data only and do not run commands or modify project files.
- Build a bounded local project context index, search its text, and open a matching source location in the editor.
- Configure the backend OpenAI provider and test its connection.
- Use project-scoped assistant conversations with bounded indexed context, persisted history, retryable responses, and source references. The assistant explains code and suggests changes; it does not apply edits or run tools.

There are no screenshots or demo assets in the repository yet.

## Architecture

- **Electron main process** owns the local FastAPI process, migrations, backend requests, and approved filesystem operations.
- **Electron preload** exposes a narrow, validated IPC API to the renderer.
- **React renderer** provides project management, planning, the workspace file tree and editor, local context search, settings, and assistant chat.
- **FastAPI backend** provides the versioned API, OpenAI provider adapter, conversation and project services, and persistence.
- **SQLite and Alembic** store project records, plans, context chunks, indexing state, conversations, and visible messages. Migrations are applied by Electron at startup.
- **Project context** is indexed and searched locally with bounded lexical matching. It is not vector or semantic search.

## Technology

Electron 44, React 19, Vite 8, CodeMirror 6, Python 3.10–3.13, FastAPI, SQLAlchemy 2, Alembic, SQLite, and the OpenAI Python SDK. JavaScript dependencies are pinned in `package-lock.json`; Python ranges and the resolved environment are recorded in `backend/pyproject.toml` and `backend/uv.lock`.

## Repository layout

```text
backend/                 FastAPI application, AI adapter, database, migrations, and tests
desktop/electron/        Electron main process, preload bridge, and desktop services
desktop/renderer/        React application, editor, styles, and UI tests
docs/                    Development notes
package.json             Desktop scripts and dependencies
```

## Prerequisites

- Node.js 22.12 or newer and npm 11 (a compatible npm release also works).
- Python 3.10 through 3.13 and [uv](https://docs.astral.sh/uv/) for the backend environment.
- A graphical desktop session to open Electron. Automated tests and the renderer build can run headlessly.
- SQLite is provided by Python; no separate database server is needed.

## Install and run

From the repository root:

```sh
npm install
cd backend
uv sync
cd ..
npm run dev
```

`npm run dev` starts the Vite renderer and Electron. Electron applies database migrations, starts the backend on a loopback address, and opens the desktop window. The selected project folder must be confirmed in BUILDX each time the app starts before workspace file access is available.

To configure the AI provider, copy `backend/.env.example` to `backend/.env`, add an OpenAI API key, and restart BUILDX:

```sh
cp backend/.env.example backend/.env
```

The example contains only empty/safe values. Keep real credentials in `backend/.env`; never commit them.

## Configuration

The backend reads `BUILDX_*` environment variables. `backend/.env.example` documents the provider settings.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BUILDX_AI_PROVIDER` | `openai` | The only provider currently implemented. |
| `BUILDX_AI_MODEL` | `gpt-5.4-mini` | OpenAI Responses API model identifier. |
| `BUILDX_OPENAI_API_KEY` | unset | Backend-only credential; required for AI generation. |
| `BUILDX_DATA_DIR` | OS application data directory | Location for the local SQLite database. Electron supplies its user-data directory. |
| `BUILDX_DATABASE_URL` | SQLite file under the data directory | Optional SQLite URL override. Only SQLite URLs are supported. |
| `BUILDX_ENVIRONMENT` | `development` | `development`, `test`, or `production`; production disables API docs. |
| `BUILDX_HOST` / `BUILDX_PORT` | `127.0.0.1` / `0` | Loopback address and port. Electron chooses an available port. |
| `BUILDX_PYTHON` | detected Python executable | Optional path override used by Electron to launch the backend. |
| `BUILDX_BACKEND_DIR` | repository `backend/` directory | Optional backend source directory override, primarily for development or packaging. |

When run outside Electron, the default SQLite database is stored under macOS `~/Library/Application Support/BUILDX`, Windows `%APPDATA%/BUILDX`, or Linux `$XDG_DATA_HOME/buildx` (default `~/.local/share/buildx`).

## Checks

Run the desktop lint, tests, and production build from the repository root:

```sh
npm run lint
npm test
npm run build
npm run check
```

Run backend tests from `backend/`:

```sh
uv run pytest
```

The renderer is JavaScript/JSX; there is no TypeScript type-check script configured. The backend test suite uses a fake provider and does not make billable AI requests. `npm run check` combines the desktop lint, tests, and build; it does not run backend tests.

For backend API development, apply migrations before launching the service directly:

```sh
cd backend
uv run alembic upgrade head
uv run python -m app
```

The development API provides `/docs` on the loopback address printed in backend startup logs. Do not expose this local API to an untrusted network.

## Security and privacy

BUILDX stores project metadata, plans, indexed text, and conversation history in local SQLite. SQLite is not encrypted by BUILDX; protect the OS account and local data directory. Electron requires native folder-picker confirmation for filesystem access, keeps filesystem calls in the main process, and rejects traversal and symbolic links. Indexing honors `.gitignore` and applies file, directory, size, and secret-pattern exclusions; review exclusions before relying on them as a complete secret scanner.

AI requests go from the backend to the configured OpenAI provider. Assistant requests include the user's question and up to five matching indexed excerpts (up to 6,000 characters total), with relative path and line ranges. Conversation history is stored locally; only a bounded recent portion is included in a request. Project plan generation also sends the plan brief and preferences to the provider. OpenAI responses are requested with provider-side storage disabled. Provider credentials remain in backend environment configuration and are not exposed to the renderer.

The assistant treats project excerpts as untrusted data. It does not have filesystem, shell, or tool access and cannot modify files. It provides explanations and proposed code as text. Streaming, autonomous execution, and AI-driven file changes are not implemented.

## Limitations and roadmap

- The context index uses local lexical term matching; it does not provide embeddings, semantic retrieval, or automatic refresh-on-file-change.
- OpenAI is the only provider. Assistant responses are non-streaming and require network access for generation.
- The assistant does not apply patches, edit files, or run commands. A future phase is planned for reviewable, explicitly approved file changes.
- Desktop packaging/installers and a release workflow are not configured yet.
- There is no repository `LICENSE` file; no license has been configured.

## Contributing

Use a focused branch for changes. Review migrations before applying them, run the relevant desktop and backend checks, and keep credentials, local databases, and generated output out of commits. Submit changes with a concise description of behavior and verification performed.
