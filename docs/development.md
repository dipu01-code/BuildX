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

The renderer receives only `window.buildxDesktop.getAppInfo()`, which returns the application name, version and operating-system platform. It cannot access Node.js, arbitrary IPC, the filesystem, a terminal, or child processes. Keep future capabilities narrowly scoped and validate them in both preload and main-process handlers.

The development server URL is supplied only to the Electron main process through `BUILDX_DEV_SERVER_URL`. Production loads the built renderer relative to the Electron entrypoint, not the shell's current working directory.

## Troubleshooting

- **Port 5173 is busy:** stop the process using it, then rerun `npm run dev`. Vite is configured to fail instead of moving to a different origin.
- **The window reports that the interface could not load:** confirm dependencies are installed, then run `npm run build` before `npm start`.
- **No desktop window appears:** run the app in a graphical desktop session; headless environments may run tests and build but cannot visually verify the window.
- **The renderer bridge is unavailable:** open developer tools only during local development and inspect the Electron startup output for preload errors.

Phases 3–5 establish the FastAPI backend, SQLite persistence, and project CRUD API. Electron runs migrations and starts the backend on a loopback port; project requests cross a narrow preload IPC bridge. Project directory paths remain metadata only until Phase 6. AI-provider workflows and process execution are not enabled.

Phase 6 assigns project filesystem operations to Electron's main process. It resolves every requested relative path against the selected project's canonical root, rejects traversal and all descendant symlinks, and returns only operation-specific results through preload IPC. Text previews are limited to 1 MiB of valid UTF-8. Paths are revalidated for each operation, but Node's path-based APIs cannot eliminate all local time-of-check/time-of-use races against another process that can mutate the same directory.
