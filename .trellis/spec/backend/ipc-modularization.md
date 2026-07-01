# IPC modularization (incremental)

## Seam

`src/main/ipc/registry.ts` — only place that calls `ipcMain.handle` / `sendEvent`.

## Rules

1. New handlers register via `registerHandler` from registry; do not import `ipcMain` in domain handler files.
2. Split `registerAllHandlers` by domain: `session`, `workspace`, `adapter`, `settings`, `dialog`, `sdk` — one file per domain exporting `registerXHandlers()`.
3. Handler request/response types live in `packages/shared/ipc/` as added (optional zod).

## Roadmap

| Phase | Deliverable |
|-------|-------------|
| 1 | registry.ts (done) |
| 2 | dialog, workspace-fs, workspace, session, prompt handlers (done) |
| 3 | typed contracts for top 10 channels |
| 4 | preload allowlist mirrors channel set |

## ADR

None yet; aligns with `doc/dev/architecture.md` Main IPC routing.