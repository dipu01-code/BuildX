# BUILDX

BUILDX is a local-first desktop workspace for organizing development projects, browsing and editing project files, planning work, and asking an AI assistant questions grounded in a local project index.

## Current capabilities

- Create and manage project records stored in a local SQLite database.
- Associate a project with a folder selected through the native folder picker; browse files and edit supported UTF-8 text files in the desktop workspace.
- Draft, edit, save, and reopen project plans. Plans are data only and do not run commands or modify project files.
- Build a bounded local project context index, search its text, and open a matching source location in the editor.
- Configure the backend OpenAI provider and test its connection.
- Use project-scoped assistant conversations with bounded indexed context, persisted history, retryable responses, and source references. The assistant explains code and suggests changes; it does not apply edits or run tools.
- Generate one-file code change proposals in the assistant, inspect the exact original and proposed contents, and explicitly approve before BUILDX applies them. Proposals are persisted and rejectable; creates and modifications are supported, while deletion and multi-file changes are not.
- Run manually entered project commands from a reviewed terminal panel. Each run is scoped to the currently authorized project folder, has bounded time/output/concurrency, and can be stopped; process sessions are in memory and are ended when BUILDX closes.
- Discover configured test commands, review and run them through the same terminal process manager, inspect bounded output and parsed summaries, and ask the existing assistant to explain a failed run. Suggested code fixes are created as Phase 12 proposals for explicit review.

There are no screenshots or demo assets in the repository yet.

## Architecture

- **Electron main process** owns the local FastAPI process, migrations, backend requests, and approved filesystem operations.
- **Electron preload** exposes a narrow, validated IPC API to the renderer, including project-scoped terminal session controls.
- **React renderer** provides project management, planning, the workspace file tree and editor, local context search, settings, assistant chat, reviewed command execution, and test/debug views.
- **FastAPI backend** provides the versioned API, OpenAI provider adapter, conversation and project services, and persistence.
- **SQLite and Alembic** store project records, plans, context chunks, indexing state, conversations, and visible messages. Migrations are applied by Electron at startup.
- Change proposals and their lifecycle are stored in SQLite. Electron is the only proposal-driven file writer and requires an approved proposal plus the currently confirmed project folder.
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

The terminal process manager also accepts `BUILDX_TERMINAL_TIMEOUT_MS` (default 300000; 1000–1800000), `BUILDX_TERMINAL_MAX_CONCURRENCY` (default 2; 1–4), and `BUILDX_TERMINAL_MAX_OUTPUT_BYTES` (default 524288; 16384–2097152).

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

## Project terminal

The Terminal tab runs a command only after the user reviews its exact text and project directory, then explicitly selects Run. Commands execute through the system shell with a filtered environment, no interactive stdin, and no PTY on macOS, Linux, and Windows. This is a local command runner, not a security sandbox: shell commands can still access the user's files and available tools. BUILDX applies a five-minute default timeout, at most two concurrent commands, and a 512 KiB output cap per session; environment variables can adjust those limits within the documented bounds. Output is rendered as text. Stop requests target the process group on macOS/Linux and the shell process on Windows; deliberately detached descendants may outlive Stop, and Windows descendant cleanup is not guaranteed. The last 20 completed sessions are kept in memory; app shutdown requests termination of active commands.

## Project testing and debugging

Open the Testing tab in a project workspace. Discovery reads root project configuration without running it: `package.json` `test` and `test:*` scripts, installed Vitest/Jest configuration files, and pytest settings in `pytest.ini`, `pyproject.toml`, or `setup.cfg`. A detected runner must be available locally or on the inherited `PATH`; BUILDX does not install packages. Unsupported or missing configurations can be entered manually. Review the exact command, project folder, source, and runner, then choose **Run reviewed tests**. Runs use the existing terminal manager's timeout, concurrency, output cap, cancellation, and process cleanup behavior.

The results view retains raw stdout/stderr in the process manager's bounded in-memory session history (up to 20 completed sessions) and shows exit status, duration, and any parsed counts. BUILDX parses common summary lines from Vitest, Jest, and pytest; it extracts failed test names from pytest summaries. Reporter variations and other formats remain visible as raw output and are labelled unparsed. A zero exit code without a recognized summary is not reported as verified test success. Test logs do not persist as separate records; when you ask the assistant to debug a run, up to 6,000 characters of output are redacted for common token, credential, and local-path patterns and sent with run metadata plus the existing bounded indexed project context. The resulting question and answer are saved in a local assistant conversation and are also sent to the configured provider.

After analysis, you can request a fix for a project-relative file. BUILDX reads the current file and creates a pending Phase 12 change proposal; it does not write the fix or rerun tests. Review, approve, and apply the proposal in the Assistant tab. Then explicitly review and run the test command again if you want to verify the change. The diagnostic redactor covers common patterns and cannot guarantee detection of every secret; inspect the evidence before sending it to the provider.

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

The conversational assistant treats project excerpts as untrusted data and cannot apply changes, run tools, or access the filesystem. Phase 12 adds a separate review-first proposal path: it handles one file per proposal, supports creating or modifying text files up to 1 MiB, and displays the full original and proposed contents. Applying requires a deliberate approval action; Electron checks that the affected editor buffer is clean, that the project folder remains authorized, and that the original SHA-256 still matches. New file creation fails if the destination already exists. Protected credential and key paths, traversal, and symlinks are rejected. Multi-file atomicity and rollback are not provided; the workflow is limited to one operation to avoid partial change sets. A local process can still race path-based filesystem calls, as documented for Phase 6. The workflow does not execute commands or tests. Run `UV_CACHE_DIR=/private/tmp/buildx-uv-cache uv run pytest` from `backend/` and `npm run check` from the repository root.

## Limitations and roadmap

- The context index uses local lexical term matching; it does not provide embeddings, semantic retrieval, or automatic refresh-on-file-change.
- OpenAI is the only provider. Assistant responses are non-streaming and require network access for generation.
- The assistant does not apply patches, edit files, or run commands. A future phase is planned for reviewable, explicitly approved file changes.
- Desktop packaging/installers and a release workflow are not configured yet.
- There is no repository `LICENSE` file; no license has been configured.

## Contributing

Use a focused branch for changes. Review migrations before applying them, run the relevant desktop and backend checks, and keep credentials, local databases, and generated output out of commits. Submit changes with a concise description of behavior and verification performed.
