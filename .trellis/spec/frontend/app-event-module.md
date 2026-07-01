# AppEvent application module

## Seam

`src/renderer/src/stores/apply-app-event.ts` — all `AppEvent` → timeline/run/queue side effects.

## Rules

1. `ui-store.processEvent` only delegates to `applyAppEvent`; do not grow the switch in ui-store.
2. Session routing guard uses `isSessionScopedAppEvent` from `@shared/app-event-session`.
3. New event types: add handler in apply-app-event + union in `packages/shared/app-events.ts`.

## Tests

Future: table-driven tests per event type with mock `StoreApi`.