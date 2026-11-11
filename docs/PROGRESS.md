# BUILDX progress

Resume point for future sessions. Update this file at the end of every phase.

## Rules

- One phase at a time; exactly one Git commit per completed phase.
- Run `npm run check`, `npm run test:core`, and `cd backend && uv run pytest` before committing.
- Refresh the knowledge graph after code changes: `graphify update .` (output in `graphify-out/`, not committed).

## Phase status

| Phase | Title | Status | Commit |
|---|---|---|---|
| 0 | Initial setup | Done | `d457d30` |
| 1 | Secure Electron foundation | Done | `befa2ca` |
| 2 | Design system and interactions | Done | `941eef4` |
| 3 | FastAPI backend foundation | Done | `2362325` |
| 4 | SQLite persistence and Alembic | Done | `9d67c9e` |
| 5 | Project management | Done | `f04e0f0` |
| 6 | Secure workspace file operations | Done | `07a6ebd` |
| 7 | Code editor | Done | `85caa7f` |
| 8 | AI provider infrastructure | Done | `766a1e2` |
| 9 | AI project planning | Done | `ac34a3f` |
| 10 | Project indexing and retrieval | Done | `288c5fa` |
| 11 | Project coding assistant | Done | `47a93bc` |
| 12 | Reviewed AI code changes | Done | `204bf79` |
| 13 | Terminal and process management | Done | `df373d6` (+ fixes `8fe9cc1`, `857b991`) |
| 14 | Testing and AI debugging | Done | `4b138cc` |
| 15 | Git integration (Source control tab) | Done | see `git log` |
| 16 | Settings and operational reliability | Done | `b421f45` + `43b0530` |
| 17 | CI and release hygiene (CI workflow, LICENSE, httpx warning) | Not started | — |
| 18 | Packaging, installers, release workflow | Not started | — |

## Phase 16 completion (2026-11-10, committed in `43b0530`)

Commit `b421f45` stored settings but services did not use them. Completion work:

- Editor applies font size, tab size, word wrap; auto-save implemented.
- Compact UI density applied through Electron zoom.
- Terminal manager applies saved timeout and retention; indexing toggle blocks refreshes.
- Settings reset now reloads full settings instead of using the reset reply.
- Settings copy no longer claims unapplied preferences (startup behavior, confirmations, max index size, telemetry, minimap).
- Backend writes rotating JSON logs to `<data dir>/logs/backend.log`.
- Fixed: macOS Dock "activate" never reopened the window when the backend started normally.
- Fixed: a save could mark text typed during the save as saved.
- Vitest now runs `*.test.js` renderer tests (two files were silently skipped).
- New tests: settings bridge, Settings screen, editor preferences, auto-save, terminal preferences, backend log file.

## Phase 15 (2026-11-11)

- `desktop/electron/git-service.cjs`: status, diff, stage, unstage, commit; runs `git` without a shell in the confirmed project folder, only when it is the repository top level.
- Hooks, fsmonitor, external diff, textconv, and commit signing are disabled; pathspecs are literal.
- Commit requires the reviewed staged paths to match the current index.
- `GitPanel.jsx` is the Source control tab. Details in `docs/development.md`.

## Open items needing a decision

- `core/` + `cli/` (coding-problem engine from the "Day-2" hand-over) is not used by the desktop app; decide whether it belongs in BUILDX.
- Untracked root `app.js` (React Native snippet) is unrelated to BUILDX.

## Known gaps / technical debt

- Packaging blocker (Phase 18): Electron launches Python from `backend/.venv`; an installed app needs a bundled backend.
- Electron main-process errors go to the console only (backend logs go to a file).
- No CI workflow and no LICENSE file.
- Starlette deprecation warning about `httpx` in backend tests.
