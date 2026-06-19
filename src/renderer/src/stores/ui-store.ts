import { create } from 'zustand'
import type { AppEvent } from '@shared/app-events'

interface SessionItem {
  sessionId: string
  sessionFile?: string
  title: string
  updatedAt: number
  messageCount?: number
  modelId: string
}

interface RunState {
  status: 'idle' | 'running' | 'failed'
  model?: string
  thinkingLevel?: string
  startTime?: number
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
  toolCount: number
  errorCount: number
  activeTool?: string
}

interface TimelineItem {
  id: string
  type: 'user-message' | 'assistant-message' | 'tool-call' | 'compaction' | 'error' | 'slash'
  text?: string
  toolName?: string
  toolPhase?: string
  toolOutput?: string
  toolDetails?: any
  isError?: boolean
  slashCommand?: string
  slashStatus?: 'dispatched' | 'ok' | 'error' | 'info'
  timestamp: number
}

interface FileChange {
  path: string
  source: string
  changeType: string
  turnId?: string
}

interface UIState {
  // Workspace
  currentWorkspace: string | null
  recentProjects: string[]
  setWorkspace: (path: string) => void

  // Sessions
  sessions: SessionItem[]
  currentSessionId: string | null
  setSessions: (s: SessionItem[]) => void
  setCurrentSession: (id: string) => void
  loadHistoryItems: (items: TimelineItem[]) => void

  // Timeline
  timelineItems: TimelineItem[]
  streamingAssistantId: string | null
  appendTimeline: (item: TimelineItem) => void
  updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => void
  appendDeltaToStreamingAssistant: (delta: string) => void
  setStreamingAssistantFinalText: (text: string) => void
  clearTimeline: () => void

  // Run
  runState: RunState
  setRunState: (patch: Partial<RunState>) => void

  // File changes
  fileChanges: FileChange[]
  addFileChange: (fc: FileChange) => void
  clearFileChanges: () => void

  // Panel
  activePanel: 'review' | 'trellis' | 'run' | 'context' | 'intercom'
  setActivePanel: (p: 'review' | 'trellis' | 'run' | 'context' | 'intercom') => void

  // Extension config routing (B-layer: adapter config page requests)
  pendingExtensionConfig: string | null
  requestExtensionConfig: (pluginName: string | null) => void

  // Model picker (A-layer: /model opens panel, not silent cycle)
  modelPickerOpen: boolean
  setModelPickerOpen: (open: boolean) => void

  // Thinking picker
  thinkingPickerOpen: boolean
  setThinkingPickerOpen: (open: boolean) => void

  // Event processing
  processEvent: (event: AppEvent) => void
}

let itemSeq = 0
function nextItemId(): string {
  return `item-${++itemSeq}`
}

export const useUIStore = create<UIState>((set, get) => ({
  currentWorkspace: null,
  recentProjects: [],
  setWorkspace: (path) => set({ currentWorkspace: path }),

  sessions: [],
  currentSessionId: null,
  setSessions: (s) => set({ sessions: s }),
  setCurrentSession: (id) => {
    set({ currentSessionId: id })
  },
  loadHistoryItems: (items: TimelineItem[]) => {
    set({
      timelineItems: items,
      streamingAssistantId: null,
      fileChanges: [],
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
  },

  timelineItems: [],
  streamingAssistantId: null,
  appendTimeline: (item) => set((s) => ({ timelineItems: [...s.timelineItems, item] })),
  updateTimelineItem: (id, patch) => set((s) => ({
    timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  })),
  appendDeltaToStreamingAssistant: (delta) =>
    set((s) => {
      const id = s.streamingAssistantId
      if (!id || !delta) return s
      return {
        timelineItems: s.timelineItems.map((i) =>
          i.id === id ? { ...i, text: (i.text || '') + delta } : i,
        ),
      }
    }),
  setStreamingAssistantFinalText: (text) =>
    set((s) => {
      const id = s.streamingAssistantId
      if (!id) return { streamingAssistantId: null }
      return {
        streamingAssistantId: null,
        timelineItems: s.timelineItems.map((i) => (i.id === id ? { ...i, text } : i)),
      }
    }),
  clearTimeline: () => set({ timelineItems: [], streamingAssistantId: null }),

  runState: { status: 'idle', toolCount: 0, errorCount: 0 },
  setRunState: (patch) => set((s) => ({ runState: { ...s.runState, ...patch } })),

  fileChanges: [],
  addFileChange: (fc) => set((s) => ({ fileChanges: [...s.fileChanges.filter(f => f.path !== fc.path), fc] })),
  clearFileChanges: () => set({ fileChanges: [] }),

  activePanel: 'review',
  setActivePanel: (p) => set({ activePanel: p }),

  pendingExtensionConfig: null,
  requestExtensionConfig: (pluginName) => set({ pendingExtensionConfig: pluginName }),

  modelPickerOpen: false,
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),

  thinkingPickerOpen: false,
  setThinkingPickerOpen: (open) => set({ thinkingPickerOpen: open }),

  processEvent: (event) => {
    const state = get()

    switch (event.type) {
      case 'message': {
        if (event.phase === 'start' && event.role === 'user') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'user-message',
            text: event.text,
            timestamp: event.timestamp,
          })
        } else if (event.role === 'assistant') {
          if (event.phase === 'start') {
            const id = nextItemId()
            state.appendTimeline({
              id,
              type: 'assistant-message',
              text: '',
              timestamp: event.timestamp,
            })
            set({ streamingAssistantId: id })
          } else if (event.phase === 'delta' && event.text) {
            state.appendDeltaToStreamingAssistant(event.text)
          } else if (event.phase === 'end') {
            if (event.text !== undefined) {
              state.setStreamingAssistantFinalText(event.text)
            } else {
              set({ streamingAssistantId: null })
            }
          }
        }
        break
      }
      case 'tool': {
        if (event.phase === 'start') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'tool-call',
            toolName: event.toolName,
            toolPhase: 'start',
            timestamp: event.timestamp,
          })
          state.setRunState({ activeTool: event.toolName })
        } else if (event.phase === 'end') {
          const items = get().timelineItems
          const lastTool = [...items].reverse().find((i) => i.type === 'tool-call' && i.toolName === event.toolName && i.toolPhase === 'start')
          if (lastTool) {
            state.updateTimelineItem(lastTool.id, {
              toolPhase: 'end',
              toolOutput: typeof event.output === 'string' ? event.output : JSON.stringify(event.output, null, 2),
              toolDetails: (event as any).details,
              isError: event.isError,
            })
          }
          state.setRunState({
            toolCount: get().runState.toolCount + 1,
            activeTool: undefined,
            errorCount: get().runState.errorCount + (event.isError ? 1 : 0),
          })
        }
        break
      }
      case 'file': {
        state.addFileChange({
          path: event.path,
          source: event.source,
          changeType: event.changeType,
          turnId: event.turnId,
        })
        break
      }
      case 'run': {
        if (event.phase === 'started' || event.phase === 'running') {
          state.setRunState({ status: 'running', startTime: event.timestamp, model: event.model, thinkingLevel: event.thinkingLevel })
        } else if (event.phase === 'idle') {
          state.setRunState({ status: 'idle', activeTool: undefined })
        } else if (event.phase === 'failed') {
          state.setRunState({ status: 'failed' })
        } else if (event.phase === 'state') {
          const patch: Record<string, string | undefined> = {}
          if (event.model !== undefined) patch.model = event.model
          if (event.thinkingLevel !== undefined) patch.thinkingLevel = event.thinkingLevel
          state.setRunState(patch)
        }
        if (event.usage) {
          state.setRunState({ usage: event.usage })
        }
        if (event.toolStats) {
          state.setRunState({ toolCount: event.toolStats.total, errorCount: event.toolStats.failed })
        }
        break
      }
      case 'compaction': {
        if (event.phase === 'end') {
          state.appendTimeline({
            id: nextItemId(),
            type: 'compaction',
            text: event.summary,
            timestamp: event.timestamp,
          })
        }
        break
      }
      case 'slash': {
        state.appendTimeline({
          id: nextItemId(),
          type: 'slash',
          slashCommand: event.command,
          slashStatus: event.status,
          text: event.text,
          isError: event.status === 'error',
          timestamp: event.timestamp,
        })
        break
      }
    }
  },
}))
