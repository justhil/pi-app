import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AppEvent } from '@shared/app-events'

// Generic status-line extractor (replaces pi-search-specific piSearchStatusFromUpdate).
// Pulls the first meaningful line from a tool update output, truncated for the timeline summary.
function extractStatusLine(output: unknown): string | null {
  if (!output) return null
  const text =
    typeof output === 'string'
      ? output
      : Array.isArray((output as any)?.content)
        ? (output as any).content.map((c: any) => c?.text || '').join('')
        : typeof (output as any)?.text === 'string'
          ? (output as any).text
          : ''
  const t = text.trim()
  if (!t) return null
  if (t.length > 120) return `${t.slice(0, 120)}…`
  return t
}

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
  activeToolStatus?: string
}

interface TimelineItem {
  id: string
  type: 'user-message' | 'assistant-message' | 'tool-call' | 'compaction' | 'error' | 'slash'
  text?: string
  toolName?: string
  toolCallId?: string
  toolPhase?: string
  toolOutput?: string
  toolDetails?: any
  toolStatusLine?: string
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

  // Theme + layout (persisted)
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
  sidebarWidth: number
  setSidebarWidth: (w: number) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  rightPanelWidth: number
  setRightPanelWidth: (w: number) => void
  rightPanelCollapsed: boolean
  toggleRightPanel: () => void

  // Last picker selections (persisted, cross-session memory)
  lastModel: string | null
  lastThinking: string | null
  rememberModel: (model: string) => void
  rememberThinking: (level: string) => void

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

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
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
    const { lastModel, lastThinking } = get()
    set({
      timelineItems: items,
      streamingAssistantId: null,
      fileChanges: [],
      // On session switch, seed runState from remembered selections so the picker
      // doesn't blank out before a run event arrives.
      runState: { status: 'idle', toolCount: 0, errorCount: 0, model: lastModel ?? undefined, thinkingLevel: lastThinking ?? undefined },
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
  setRunState: (patch) => set((s) => {
    const next = { ...s.runState, ...patch }
    // Mirror model/thinking selections into lastModel/lastThinking for cross-session memory,
    // unless explicitly reset to undefined.
    const extra: Partial<UIState> = {}
    if (patch.model !== undefined) extra.lastModel = patch.model
    if (patch.thinkingLevel !== undefined) extra.lastThinking = patch.thinkingLevel
    return { runState: next, ...extra }
  }),

  fileChanges: [],
  addFileChange: (fc) => set((s) => ({ fileChanges: [...s.fileChanges.filter(f => f.path !== fc.path), fc] })),
  clearFileChanges: () => set({ fileChanges: [] }),

  activePanel: 'review',
  setActivePanel: (p) => set({ activePanel: p }),

  theme: 'system',
  setTheme: (t) => set({ theme: t }),
  sidebarWidth: 224,
  setSidebarWidth: (w) => set({ sidebarWidth: Math.min(Math.max(w, 180), 340) }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  rightPanelWidth: 288,
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.min(Math.max(w, 240), 420) }),
  rightPanelCollapsed: false,
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),

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
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolPhase: 'start',
            timestamp: event.timestamp,
          })
          state.setRunState({ activeTool: event.toolName })
        } else if (event.phase === 'update') {
          const items = get().timelineItems
          const lastTool = [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId)
            || [...items].reverse().find((i) => i.type === 'tool-call' && i.toolName === event.toolName && (i.toolPhase === 'start' || i.toolPhase === 'update'))
          const line = extractStatusLine(event.output)
          if (lastTool && line) {
            state.updateTimelineItem(lastTool.id, {
              toolPhase: 'update',
              toolStatusLine: line,
            })
          }
          // Update Run panel active tool status for any tool producing a status line.
          if (line) {
            state.setRunState({ activeTool: event.toolName, activeToolStatus: line })
          }
        } else if (event.phase === 'end') {
          const items = get().timelineItems
          const lastTool = [...items].reverse().find((i) => i.type === 'tool-call' && i.toolName === event.toolName && (i.toolPhase === 'start' || i.toolPhase === 'update'))
          let outText = ''
          const raw = event.output as any
          if (typeof raw === 'string') outText = raw
          else if (raw?.content && Array.isArray(raw.content)) {
            outText = raw.content.map((c: any) => c?.text || '').join('')
          } else if (raw != null) outText = JSON.stringify(raw, null, 2)
          if (lastTool) {
            state.updateTimelineItem(lastTool.id, {
              toolPhase: 'end',
              toolOutput: outText,
              toolDetails: (event as any).details,
              toolStatusLine: undefined,
              isError: event.isError,
            })
          }
          state.setRunState({
            toolCount: get().runState.toolCount + 1,
            activeTool: undefined,
            activeToolStatus: undefined,
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
    }),
    {
      name: 'pi-desktop-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentWorkspace: s.currentWorkspace,
        recentProjects: s.recentProjects,
        activePanel: s.activePanel,
        theme: s.theme,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        rightPanelWidth: s.rightPanelWidth,
        rightPanelCollapsed: s.rightPanelCollapsed,
        lastModel: s.lastModel,
        lastThinking: s.lastThinking,
      }),
      version: 1,
    },
  ),
)
