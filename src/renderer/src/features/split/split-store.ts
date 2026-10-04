import { create } from 'zustand'
import { workspacePathsEqual } from '@shared/workspace-path'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  applyPreset,
  assignSession,
  closePane as closePaneIn,
  dropPane,
  equalize,
  needsFocusMode,
  neighbour,
  openPane,
  resizeSplit,
  sanitizeLayout,
  setActivePane,
  singleLayout,
  type PaneSession,
  type Preset,
  type Side,
  type SplitLayout,
} from './split-layout'
import { OPEN_IN_PANE_EVENT } from './split-dnd'

const KEY = 'pi-split-layout-v2'
const OLD_KEY = 'pi-split-layout-v1'

function load(): SplitLayout {
  try {
    return sanitizeLayout(JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || 'null')) ?? singleLayout()
  } catch {
    return singleLayout()
  }
}

export const useSplitStore = create<SplitLayout>(load)

useSplitStore.subscribe((layout) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    // layout is a per-device convenience
  }
})

/** The focused session as a pane entry (null while drafting a new session). */
export function focusedPaneSession(): PaneSession | null {
  const s = useUIStore.getState()
  const file = s.historySessionFile
  if (!file || !s.currentSessionId || !s.currentWorkspace) return null
  const meta = s.sessions.find((x) => sessionFilesEqual(x.sessionFile, file))
  return { sessionId: s.currentSessionId, sessionFile: file, workspace: s.currentWorkspace, title: meta?.title || meta?.firstMessage || '' }
}

/** Make the global (focused) session match a pane: the existing switch path, no new runtime. */
async function focusSessionOf(session: PaneSession | null): Promise<void> {
  const s = useUIStore.getState()
  if (!session) {
    enterBlankSession('pending-project')
    void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
    return
  }
  if (sessionFilesEqual(s.historySessionFile, session.sessionFile)) return
  if (workspacePathsEqual(session.workspace, s.currentWorkspace)) await switchSessionInPlace(session.sessionId, session.sessionFile)
  else await activateWorkspace(session.workspace, { sessionId: session.sessionId, sessionFile: session.sessionFile })
}

/** The split area's size, reported by SplitView, so new panes can be placed where they fit. */
let viewport = { w: 0, h: 0 }

/**
 * Prefer the requested side; if the new pane would be too small there, try the other axis, then a
 * preset that fits (grid for four, main-left for three). Falls back to the requested layout.
 */
function fitting(base: SplitLayout, session: PaneSession | null, opts: { anchorId?: string; side?: Side }): SplitLayout {
  const first = openPane(base, session, opts)
  if (first === base || !viewport.w || !needsFocusMode(first, viewport.w, viewport.h)) return first
  const side = opts.side ?? 'right'
  const other: Side = side === 'left' || side === 'right' ? 'bottom' : 'right'
  const alt = openPane(base, session, { ...opts, side: other, id: first.activePaneId })
  if (!needsFocusMode(alt, viewport.w, viewport.h)) return alt
  const preset = first.panes.length >= 4 ? 'grid' : first.panes.length === 3 ? 'main-left' : 'columns'
  const arranged = applyPreset(first, preset)
  return needsFocusMode(arranged, viewport.w, viewport.h) ? first : arranged
}

export const splitActions = {
  setViewport(w: number, h: number) {
    viewport = { w, h }
  },
  /** Activate a pane (click, keyboard). The only way focus moves between panes. */
  focus(paneId: string) {
    const layout = useSplitStore.getState()
    if (layout.activePaneId === paneId) return
    const pane = layout.panes.find((p) => p.id === paneId)
    if (!pane) return
    useSplitStore.setState(setActivePane(layout, paneId))
    void focusSessionOf(pane.session)
  },
  /** Open a session (or an empty pane) beside the active pane and focus it. */
  open(session: PaneSession | null, opts: { anchorId?: string; side?: Side } = {}) {
    const before = useSplitStore.getState()
    // Single pane showing nothing yet: the current view becomes the first pane's session.
    const base = before.panes.length === 1 && !before.panes[0].session ? assignSession(before, before.panes[0].id, focusedPaneSession()) : before
    const next = fitting(base, session, opts)
    if (next === base) return false
    useSplitStore.setState(next)
    void focusSessionOf(next.panes.find((p) => p.id === next.activePaneId)?.session ?? null)
    return true
  },
  /** Show a session in a given pane (drop onto a pane's middle). */
  replace(paneId: string, session: PaneSession) {
    const layout = useSplitStore.getState()
    const shownElsewhere = layout.panes.find((p) => p.id !== paneId && p.session?.sessionFile === session.sessionFile)
    if (shownElsewhere) return splitActions.focus(shownElsewhere.id)
    useSplitStore.setState(setActivePane(assignSession(layout, paneId, session), paneId))
    void focusSessionOf(session)
  },
  /** Close a pane. Its session keeps existing and keeps running. */
  close(paneId: string) {
    const before = useSplitStore.getState()
    const next = closePaneIn(before, paneId)
    if (next === before) return
    useSplitStore.setState(next)
    if (next.activePaneId !== before.activePaneId) void focusSessionOf(next.panes.find((p) => p.id === next.activePaneId)?.session ?? null)
  },
  /** Drop a pane onto another pane: beside it, or swap with it (center). */
  drop(paneId: string, targetId: string, where: Side | 'center') {
    useSplitStore.setState(dropPane(useSplitStore.getState(), paneId, targetId, where))
    // The dragged pane is what the user is working with: it becomes the active one.
    splitActions.focus(paneId)
  },
  resize(splitId: string, ratio: number, minFraction: number) {
    useSplitStore.setState(resizeSplit(useSplitStore.getState(), splitId, ratio, minFraction))
  },
  equalize() {
    useSplitStore.setState(equalize(useSplitStore.getState()))
  },
  preset(preset: Preset) {
    useSplitStore.setState(applyPreset(useSplitStore.getState(), preset))
  },
  /** Focus the pane in a direction (keyboard), tmux's select-pane -L/-R/-U/-D. */
  focusDir(dir: Side) {
    const id = neighbour(useSplitStore.getState(), dir)
    if (id) splitActions.focus(id)
  },
  /** Step focus to the previous / next pane (keyboard). */
  step(dir: -1 | 1) {
    const l = useSplitStore.getState()
    const i = l.panes.findIndex((p) => p.id === l.activePaneId)
    const next = l.panes[i + dir]
    if (next) splitActions.focus(next.id)
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener(OPEN_IN_PANE_EVENT, (e) => {
    const session = (e as CustomEvent<PaneSession>).detail
    if (session?.sessionFile) splitActions.open(session)
  })
}

/**
 * Keep the active pane on the focused session: opening a session from the sidebar,
 * creating one, or a pane activation all end with the global session changing.
 * Background events never change the focused session, so they never move panes.
 */
let syncing = false
useUIStore.subscribe((s, prev) => {
  if (syncing || (s.historySessionFile === prev.historySessionFile && s.currentSessionId === prev.currentSessionId && s.sessions === prev.sessions)) return
  const session = focusedPaneSession()
  if (!session) return
  syncing = true
  try {
    const layout = useSplitStore.getState()
    const active = layout.panes.find((p) => p.id === layout.activePaneId)
    if (active?.session?.sessionFile === session.sessionFile && active.session.title === session.title) return
    useSplitStore.setState(assignSession(layout, layout.activePaneId, session))
  } finally {
    syncing = false
  }
})
