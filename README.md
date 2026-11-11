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
- Review Git changes in a Source control tab: see the branch and per-file diffs, stage or unstage files, and make local commits after reviewing the exact staged files. Git hooks are not run, and BUILDX does not push.

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

## Settings and operational reliability

BUILDX keeps a centralized, typed settings system for non-secret user preferences. Preferences are persisted in the local SQLite database (`app_settings` table) and survive application restarts. Sensitive credentials — for example `BUILDX_OPENAI_API_KEY` — are never stored in settings; they remain in backend environment configuration (`backend/.env`) and are never returned by the settings API, shown on the settings screen, or written to logs.

### Settings sections

The Settings view organizes preferences into:

- **General** — startup behavior, default project directory, confirmation preferences for destructive actions, reset to defaults. These three preferences are stored for a later phase: BUILDX currently always opens to Home and always confirms deletes and discards.
- **Appearance** — theme (system / light / dark) and UI density. Compact density is applied immediately (90% interface zoom). This phase renders a dark interface; the theme preference is stored for a later light-theme phase.
- **Editor** — font size, tab size, and word wrap are applied to open editors immediately. Auto-save (off by default) saves the active file about one second after typing stops; a save error (for example a disk conflict) pauses auto-save until you resolve it. Minimap is stored only.
- **AI Provider** — provider and model metadata, connection status, and connection testing. Credentials are managed in `backend/.env`; no credential ever passes through the UI.
- **Terminal** — default working directory (preference only; Phase 13 command approval and approved project paths remain enforced), output retention limit, default timeout. Retention and timeout are applied by the Electron process manager when settings load or are saved, and override `BUILDX_TERMINAL_TIMEOUT_MS`; a new timeout applies to commands started afterwards.
- **Project Context** — indexing enablement and maximum indexed file size. Turning indexing off blocks new index refreshes; existing indexed text stays searchable. The size preference is stored only; Phase 10 security boundaries (.gitignore, sensitive-path exclusion, 1 MiB limit) are never bypassed by preferences.
- **Privacy** — what is stored locally and what is sent to the configured AI provider. BUILDX contains no telemetry; the telemetry preference is stored only.
- **Operational Health** — on-demand status for the backend, database, migrations, AI provider, project indexing, terminal, and Electron. No automatic polling; refresh manually.

### Settings API

Versioned backend endpoints (no secrets in responses):

- `GET /api/v1/settings` — read typed preferences
- `PATCH /api/v1/settings` — partial update; unrelated sections are preserved
- `POST /api/v1/settings/reset` — restore all preferences to safe defaults
- `GET /api/v1/settings/health` — operational health dashboard

### Health checks

The health dashboard reports accurate status (healthy / degraded / unavailable / not configured / unknown) for components that actually exist, including the FastAPI backend, SQLite database, migration head, AI provider configuration, project indexing service, terminal process manager, and Electron. It does not run destructive diagnostics or modify user projects.

### Diagnostic logging

The backend emits structured JSON logs, one record per line, to stderr and to `logs/backend.log` in the BUILDX data directory (for example `~/Library/Application Support/BUILDX/logs/` on macOS when run from source; Electron passes its own user-data directory). The file rotates at 1 MiB and keeps three older files. If the log directory cannot be written, logging continues on stderr only. Error records include a short support identifier (`error_id`) that is surfaced to the user so it can be correlated with logs. API keys, tokens, passwords, and private project contents are redacted and never logged.

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

## Build installers

```bash
cd backend && uv sync --group build && cd ..
npm run dist
```

This builds the renderer, bundles the backend into a standalone executable with PyInstaller, and packages the app with electron-builder into `release/` (macOS DMG/zip, Windows installer, or Linux AppImage, matching the OS you build on). Installed builds need no Python. Put backend settings such as `BUILDX_OPENAI_API_KEY` in a `.env` file in the BUILDX data folder (macOS: `~/Library/Application Support/buildx-desktop`).

To publish a release, set the `version` in `package.json`, commit, and push a matching tag (for example `v0.1.0`). `.github/workflows/release.yml` builds on all three platforms and attaches the installers to a GitHub release.

## Security and privacy

BUILDX stores project metadata, plans, indexed text, and conversation history in local SQLite. SQLite is not encrypted by BUILDX; protect the OS account and local data directory. Electron requires native folder-picker confirmation for filesystem access, keeps filesystem calls in the main process, and rejects traversal and symbolic links. Indexing honors `.gitignore` and applies file, directory, size, and secret-pattern exclusions; review exclusions before relying on them as a complete secret scanner.

AI requests go from the backend to the configured OpenAI provider. Assistant requests include the user's question and up to five matching indexed excerpts (up to 6,000 characters total), with relative path and line ranges. Conversation history is stored locally; only a bounded recent portion is included in a request. Project plan generation also sends the plan brief and preferences to the provider. OpenAI responses are requested with provider-side storage disabled. Provider credentials remain in backend environment configuration and are not exposed to the renderer.

The conversational assistant treats project excerpts as untrusted data and cannot apply changes, run tools, or access the filesystem. Phase 12 adds a separate review-first proposal path: it handles one file per proposal, supports creating or modifying text files up to 1 MiB, and displays the full original and proposed contents. Applying requires a deliberate approval action; Electron checks that the affected editor buffer is clean, that the project folder remains authorized, and that the original SHA-256 still matches. New file creation fails if the destination already exists. Protected credential and key paths, traversal, and symlinks are rejected. Multi-file atomicity and rollback are not provided; the workflow is limited to one operation to avoid partial change sets. A local process can still race path-based filesystem calls, as documented for Phase 6. The workflow does not execute commands or tests. Run `UV_CACHE_DIR=/private/tmp/buildx-uv-cache uv run pytest` from `backend/` and `npm run check` from the repository root.

## Limitations and roadmap

- The context index uses local lexical term matching; it does not provide embeddings, semantic retrieval, or automatic refresh-on-file-change.
- OpenAI is the only provider. Assistant responses are non-streaming and require network access for generation.
- The conversational assistant does not edit files or run commands itself; file changes go through Phase 12 single-file proposals that you review and approve.
- Installers are unsigned and use the default Electron icon. Windows and Linux packages are built by CI but have not been tested by hand.

## Contributing

Use a focused branch for changes. Review migrations before applying them, run the relevant desktop and backend checks, and keep credentials, local databases, and generated output out of commits. Submit changes with a concise description of behavior and verification performed.

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push and pull request to `main`: `npm run check` and `npm run test:core` on Ubuntu and macOS, and backend `pytest` on Python 3.10 and 3.13.

## License

MIT. See [LICENSE](LICENSE).
