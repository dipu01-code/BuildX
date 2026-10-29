# BUILDX desktop development

## Requirements

- Node.js 22.12 or newer (Node 22 LTS recommended)
- npm 11 or a compatible npm release
- A graphical desktop session to open the Electron window

## Install and run

```sh
npm install
npm run dev
```

The development command starts Vite on `127.0.0.1:5173` and launches Electron only after that server responds. The development server binds to loopback and refuses to silently select another port.

## Checks and build

```sh
npm run lint
npm test
npm run build
npm run check
```

The renderer is JavaScript/JSX, so there is no TypeScript type-check command in this phase. ESLint checks JavaScript syntax and configured static rules. `npm run build` creates the Vite renderer at `desktop/renderer/dist`; `npm start` opens that built renderer in Electron. Packaging and installers are planned for Phase 18.

## Desktop boundary

The renderer receives a narrow, allow-listed `window.buildxDesktop` API through preload IPC. Project, workspace, context-index, provider, planner, conversation, and terminal methods validate their arguments in the main process and call the loopback backend or authorized workspace/process service. The renderer cannot access Node.js, arbitrary IPC, the filesystem, or child processes directly. Keep capabilities narrowly scoped and validate them in both preload and main-process handlers.

The development server URL is supplied only to the Electron main process through `BUILDX_DEV_SERVER_URL`. Production loads the built renderer relative to the Electron entrypoint, not the shell's current working directory.

## Troubleshooting

- **Port 5173 is busy:** stop the process using it, then rerun `npm run dev`. Vite is configured to fail instead of moving to a different origin.
- **The window reports that the interface could not load:** confirm dependencies are installed, then run `npm run build` before `npm start`.
- **No desktop window appears:** run the app in a graphical desktop session; headless environments may run tests and build but cannot visually verify the window.
- **The renderer bridge is unavailable:** open developer tools only during local development and inspect the Electron startup output for preload errors.

Phases 3–5 establish the FastAPI backend, SQLite persistence, and project CRUD API. Electron runs migrations and starts the backend on a loopback port; project requests cross a narrow preload IPC bridge. AI-provider connection checks arrive in Phase 8, with planning in Phase 9.

Phase 6 assigns project filesystem operations to Electron's main process. It resolves every requested relative path against a canonical root confirmed through the native folder picker during the current app run; database `root_path` metadata alone does not authorize access. Users confirm the folder again after restarting BUILDX. The service rejects traversal and descendant symlinks, and returns only operation-specific results through preload IPC. Text previews are limited to 1 MiB of valid UTF-8. Paths are revalidated for each operation, but Node's path-based APIs cannot eliminate all local time-of-check/time-of-use races against another process that can mutate the same directory.

Phase 7 adds a locally bundled CodeMirror 6 editor with lazy language loading for Python, JavaScript/JSX, TypeScript/TSX, JSON, HTML, CSS, Markdown, YAML, TOML, and plain-text fallbacks. Files open as path-keyed tabs, retain individual content and dirty state, and save only through the Electron file boundary. Saves compare a SHA-256 revision before and immediately before atomic replacement; conflicts keep edits in memory and offer save-as-copy, while discarding and reopening loads the latest disk version. Editor content and tabs are not persisted across app restarts; files over 1 MiB remain unavailable to edit.

Phase 8 adds one backend-only OpenAI provider adapter with safe status and minimal connection-test endpoints. The key remains in backend environment configuration; the renderer receives only provider/model metadata and sanitized test results. The fixed connection-test request is bounded, disables provider-side response storage, and sends no workspace content. The connection test may incur a small API charge; no live request is made in automated tests.

Phase 9 extends that provider contract with schema-constrained plan generation. A project brief and optional constraints are sent without workspace contents; the backend validates response size, the strict Pydantic plan schema, dependency references, and task cycles before returning an unsaved draft. Approved plans are stored as validated JSON with project ownership and timestamps through migration `0003_project_plans`. The planner UI supports editing, saving, reopening, updating, and deleting plans; saving a plan never executes it or changes project files. Automated planner tests use a fake provider and never make billable calls.

Phase 10 adds a Context view to opened project workspaces. Discovery runs in Electron's main process and reuses the native-picker authorization, canonical-root path validation, symlink rejection, and bounded UTF-8 reads from Phase 6. It honors root and nested `.gitignore` rules with the pinned `ignore` package and excludes generated/dependency directories, common sensitive file names and paths, likely private-key/credential content, binary files, and invalid UTF-8. Limits are 1 MiB per file, 25 MiB of indexed text, 5,000 files, and 20,000 directory entries. The scanner reads one file at a time and sends batches of at most eight files to the loopback backend.

Migration `0004_project_context` stores indexed file hashes/metadata, deterministic overlapping text chunks, and the latest job's progress/errors. Complete scans remove stale and excluded records; incomplete scans retain unseen records. Project deletion cascades to the context tables. Search is local case-insensitive lexical matching that requires all meaningful query terms; it is not semantic or vector search. Results include relative paths and line ranges and open the matching file/line in the Phase 7 editor. No indexed source content is sent to the Phase 8 provider. Run backend checks with `cd backend && uv run pytest`, and desktop lint/tests/build with `npm run check`.

Phase 11 adds project-scoped assistant conversations backed by migration `0005_project_conversations`. A request retrieves at most five matching chunks from the existing Phase 10 index, sends the question and bounded recent history to the configured OpenAI provider, and saves only the visible answer and the exact relative-path/line references supplied with it. The renderer clearly discloses this provider data transfer. Conversation messages and assistant output are size-bounded, provider failures are recorded as failed turns, pending turns recover as interrupted, and retry reuses the message request identifier. The assistant has no filesystem, shell, or tool access and cannot change project files. See the root README for setup and privacy details.

## Phase 12: reviewed code changes

Phase 12 adds structured, persisted proposals through the existing AI provider and project context index, migration `0006_change_proposals`, and project-scoped proposal listing and lifecycle routes. Each proposal contains one create or modify operation, a concise explanation, original content/hash, and proposed content. The assistant UI shows a bounded line review and requires an explicit approval action. Electron alone applies approved proposals through the confirmed-root workspace service, which blocks protected paths and symlinks, checks the original SHA-256 or new-file collision, and atomically replaces a single modified file. The affected editor tab must be clean before application; after confirmation, BUILDX refreshes the file tree and clean editor buffer.

Proposals are single-file only. Deletes, multi-file application, rollback, and transactional file/database updates are not implemented. A failure to update the proposal outcome after a successful filesystem write can leave the recorded status stale; the base hash check prevents a retry from overwriting the already changed file. The existing path-based filesystem APIs retain the Phase 6 local time-of-check/time-of-use limitation. Use `UV_CACHE_DIR=/private/tmp/buildx-uv-cache uv run pytest` from `backend/` and `npm run check` from the repository root.

## Phase 13: terminal and process management

The workspace Terminal tab requires a separate explicit review and run action for the exact command and the currently authorized project directory. Electron's main process re-resolves and validates that project root before spawning a system shell with `shell: false`, a filtered environment, and no interactive stdin/PTY. The renderer receives scoped session snapshots and text output through preload IPC; project IDs and session IDs are validated on list and stop operations. Commands are user-entered and are not sandboxed, so they can access files and tools available to the current user. The manager limits command length to 4,000 characters, defaults to a five-minute timeout, two concurrent sessions, and 512 KiB output per session; bounded environment settings can tune those limits. Timeout and stop send termination to the process group on macOS/Linux, then escalate after two seconds; on Windows they signal the shell process. Deliberately detached descendants may outlive Stop, and Windows descendant cleanup is not guaranteed. Completed sessions are retained in memory up to 20; app shutdown requests termination of active sessions. Commands cannot interactively read stdin, and session history does not persist across app restarts.

## Phase 14: testing and debugging

The Testing tab performs read-only discovery of root `package.json` test scripts, installed Vitest/Jest config files, and pytest configuration in `pytest.ini`, `pyproject.toml`, or `setup.cfg`. It checks for runner binaries without executing project code. Test commands are tagged in the existing Electron process manager and use the same exact-command/project-directory/source/runner review, timeout, concurrency, output, cancellation, and shutdown behavior as Phase 13; no parallel process service or test database tables were added. Test output is coalesced before IPC delivery and remains bounded in the manager's 20-session in-memory history.

The renderer parses common Vitest/Jest/pytest summary lines. It reports success only when it parsed a non-empty test count, found no failures/errors, and received exit code zero; unknown formats and zero-exit runs with no summary are labelled unparsed. pytest `FAILED` summary lines provide test names/messages; raw bounded stdout/stderr remains available for other failure detail. Cancellation, timeout, process launch failure, and ordinary non-zero process exit have separate labels. Reporter variations may not parse.

On explicit user action, a bounded and common-pattern-redacted excerpt plus run metadata is sent through the existing conversation/provider flow, alongside its normal bounded indexed project context. The question and assistant answer are saved in the existing local conversation database. Diagnostic output is treated as untrusted in the assistant instructions. A requested fix uses the existing proposal API and current file contents/hash to create a pending Phase 12 proposal; it does not write directly or run tests again. The proposal must be reviewed in Assistant, and any later test run requires a new command review. There are no migrations; discovery, run metadata, and raw output are in memory and expire with the application/session retention policy. Run `npm run check` and `UV_CACHE_DIR=/private/tmp/buildx-uv-cache uv run pytest` to verify the desktop and backend.
