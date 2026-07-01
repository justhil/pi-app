import type { AppEvent } from '@shared/app-events'
import type { UIState } from '@renderer/stores/ui-store-types'

export type StoreApi = {
  get: () => UIState
  set: (partial: Partial<UIState> | Record<string, unknown>) => void
  nextItemId: () => string
}

export type MessageEvent = Extract<AppEvent, { type: 'message' }>
export type ToolEvent = Extract<AppEvent, { type: 'tool' }>
export type RunEvent = Extract<AppEvent, { type: 'run' }>
export type CompactionEvent = Extract<AppEvent, { type: 'compaction' }>
export type SlashEvent = Extract<AppEvent, { type: 'slash' }>
export type AgentErrorEvent = Extract<AppEvent, { type: 'agent_error' }>