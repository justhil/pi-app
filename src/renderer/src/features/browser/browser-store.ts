import { create } from 'zustand'
import { toast } from 'sonner'
import {
  isTabVisibleInSession,
  normalizeBrowserSessionKey,
  type BrowserAgentStep,
  type BrowserBookmark,
  type BrowserDownloadInfo,
  type BrowserEvent,
  type BrowserHelpRequest,
  type BrowserTabInfo,
} from '@shared/browser-types'
import { ipcClient, onBrowserEvent } from '@renderer/lib/ipc-client'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'

export interface BrowserState {
  tabs: Record<string, BrowserTabInfo>
  order: string[]
  activeTabId: string | null
  activeTabBySession?: Record<string, string>
  activeSessionKey?: string
  downloads: Record<string, BrowserDownloadInfo>
  helpRequests: Record<string, BrowserHelpRequest>
}

export interface BrowserStoreState extends BrowserState {
  bookmarks: BrowserBookmark[]
  bookmarksBarVisible: boolean
  findResult: { tabId: string; active: number; matches: number } | null
  agentAction: { tabId: string; action: string } | null
  agentSteps: BrowserAgentStep[]
  hydrated: boolean
  setBookmarks: (bookmarks: BrowserBookmark[]) => void
  setBookmarksBarVisible: (visible: boolean) => void
  clearAgentSteps: () => void
  hydrate: () => Promise<void>
}

const BOOKMARKS_BAR_KEY = 'pi-browser-bookmarks-bar-v1'
const MAX_AGENT_STEPS = 25

function readBookmarksBarPref(): boolean {
  try {
    return localStorage.getItem(BOOKMARKS_BAR_KEY) !== '0'
  } catch {
    return true
  }
}

/** Tabs visible in `sessionKey`, with pinned tabs ordered first. */
export function visibleTabOrder(
  state: Pick<BrowserState, 'tabs' | 'order'>,
  sessionKey: string | null | undefined,
): string[] {
  const pinned: string[] = []
  const rest: string[] = []
  for (const id of state.order) {
    const tab = state.tabs[id]
    if (!tab) continue
    if (tab.pinned) pinned.push(id)
    else if (isTabVisibleInSession(tab, sessionKey)) rest.push(id)
  }
  return [...pinned, ...rest]
}

/** All open tabs stay visible across conversations in Browser Stage (pinned ordered first). */
export function visibleTabsForSession(
  tabs: Record<string, BrowserTabInfo>,
  order: readonly string[],
  _sessionKey?: string | null,
): string[] {
  const pinned: string[] = []
  const rest: string[] = []
  for (const id of order) {
    const tab = tabs[id]
    if (!tab) continue
    if (tab.pinned) pinned.push(id)
    else rest.push(id)
  }
  return [...pinned, ...rest]
}

/** Pick the tab that should be shown for `sessionKey` (remembered → own tab → pinned tab → null). */
export function activeTabForSession(
  state: Pick<BrowserState, 'tabs' | 'order' | 'activeTabBySession'>,
  sessionKey: string | null | undefined,
): string | null {
  const key = normalizeBrowserSessionKey(sessionKey)
  const visible = visibleTabOrder(state, key)
  if (visible.length === 0) return null
  const remembered = state.activeTabBySession?.[key]
  if (remembered && visible.includes(remembered)) return remembered
  const own = visible.filter((id) => {
    const t = state.tabs[id]
    return t && t.openedBy !== 'user' && normalizeBrowserSessionKey(t.openedBy.sessionKey) === key
  })
  return own.at(-1) ?? visible.at(-1) ?? null
}

/** Pure reducer: switch the browser view to `sessionKey`, remembering the previous session's tab. */
export function switchBrowserSession<T extends Pick<BrowserState, 'tabs' | 'order' | 'activeTabId' | 'activeTabBySession' | 'activeSessionKey'>>(
  state: T,
  sessionKey: string | null | undefined,
): T {
  const nextKey = normalizeBrowserSessionKey(sessionKey)
  const bySession = { ...(state.activeTabBySession ?? {}) }
  if (state.activeSessionKey && state.activeTabId && state.tabs[state.activeTabId]) {
    if (isTabVisibleInSession(state.tabs[state.activeTabId], state.activeSessionKey)) {
      bySession[state.activeSessionKey] = state.activeTabId
    }
  }
  const nextState = {
    ...state,
    activeSessionKey: nextKey,
    activeTabBySession: bySession,
  }
  const nextTabId = activeTabForSession({ ...nextState, activeTabId: null }, nextKey)
  if (nextTabId) bySession[nextKey] = nextTabId
  return {
    ...nextState,
    activeTabId: nextTabId,
  }
}

/** Pure reducer: move tabs opened in a draft session to the materialized session file. */
export function adoptBrowserSessionInState<T extends Pick<BrowserState, 'tabs' | 'activeTabBySession' | 'activeSessionKey'>>(
  state: T,
  fromSessionKey: string | null | undefined,
  toSessionKey: string | null | undefined,
): T {
  const from = normalizeBrowserSessionKey(fromSessionKey)
  const to = normalizeBrowserSessionKey(toSessionKey)
  if (!from || !to || from === to) return state
  let changed = false
  const tabs: Record<string, BrowserTabInfo> = {}
  for (const [id, tab] of Object.entries(state.tabs)) {
    if (tab.openedBy !== 'user' && normalizeBrowserSessionKey(tab.openedBy.sessionKey) === from) {
      tabs[id] = { ...tab, openedBy: { sessionKey: to } }
      changed = true
    } else {
      tabs[id] = tab
    }
  }
  const bySession = state.activeTabBySession ? { ...state.activeTabBySession } : undefined
  if (bySession && bySession[from]) {
    if (!bySession[to]) bySession[to] = bySession[from]
    delete bySession[from]
    changed = true
  }
  const activeSessionKey = state.activeSessionKey === from ? to : state.activeSessionKey
  if (activeSessionKey !== state.activeSessionKey) changed = true
  if (!changed) return state
  return {
    ...state,
    tabs,
    ...(bySession ? { activeTabBySession: bySession } : {}),
    ...(activeSessionKey ? { activeSessionKey } : {}),
  }
}

/** Pure reducer for Main → Renderer browser events (unit-tested). */
export function applyBrowserEvent<
  T extends Pick<
    BrowserState,
    'tabs' | 'order' | 'activeTabId' | 'activeTabBySession' | 'activeSessionKey' | 'downloads' | 'helpRequests'
  > &
    Partial<Pick<BrowserStoreState, 'findResult' | 'agentAction' | 'agentSteps'>>,
>(state: T, event: BrowserEvent): T {
  switch (event.type) {
    case 'tab-updated': {
      const exists = !!state.tabs[event.tab.tabId]
      const tabs = { ...state.tabs, [event.tab.tabId]: event.tab }
      const order = exists ? state.order : [...state.order, event.tab.tabId]
      if (!state.activeSessionKey) {
        return { ...state, tabs, order }
      }
      const bySession = { ...(state.activeTabBySession ?? {}) }
      if (event.tab.openedBy !== 'user' && !event.tab.pinned) {
        const owner = normalizeBrowserSessionKey(event.tab.openedBy.sessionKey)
        if (!exists || !bySession[owner]) bySession[owner] = event.tab.tabId
      }
      const visibleInActive = isTabVisibleInSession(event.tab, state.activeSessionKey)
      const activeTabId =
        state.activeTabId && tabs[state.activeTabId] && isTabVisibleInSession(tabs[state.activeTabId], state.activeSessionKey)
          ? state.activeTabId
          : visibleInActive
            ? event.tab.tabId
            : null
      if (activeTabId) bySession[state.activeSessionKey] = activeTabId
      return { ...state, tabs, order, activeTabId, activeTabBySession: bySession }
    }
    case 'tab-closed': {
      if (!state.tabs[event.tabId]) return state
      const tabs = { ...state.tabs }
      delete tabs[event.tabId]
      const order = state.order.filter((id) => id !== event.tabId)
      const extraClean = {
        ...(state.findResult?.tabId === event.tabId ? { findResult: null } : {}),
        ...(state.agentAction?.tabId === event.tabId ? { agentAction: null } : {}),
      }
      if (!state.activeSessionKey && !state.activeTabBySession) {
        return {
          ...state,
          ...extraClean,
          tabs,
          order,
          activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
        }
      }
      const bySession = { ...(state.activeTabBySession ?? {}) }
      for (const [k, v] of Object.entries(bySession)) {
        if (v === event.tabId) delete bySession[k]
      }
      const base = { ...state, ...extraClean, tabs, order, activeTabBySession: bySession }
      const activeTabId =
        state.activeTabId === event.tabId
          ? state.activeSessionKey
            ? activeTabForSession({ ...base, activeTabId: null }, state.activeSessionKey)
            : null
          : state.activeTabId
      if (state.activeSessionKey && activeTabId) bySession[state.activeSessionKey] = activeTabId
      return { ...base, activeTabId }
    }
    case 'tab-focused': {
      if (!state.activeSessionKey) {
        return { ...state, activeTabId: event.tabId, ...('findResult' in state ? { findResult: null } : {}) }
      }
      if (event.tabId && state.tabs[event.tabId] && !isTabVisibleInSession(state.tabs[event.tabId], state.activeSessionKey)) {
        const tab = state.tabs[event.tabId]
        if (tab.openedBy !== 'user') {
          const owner = normalizeBrowserSessionKey(tab.openedBy.sessionKey)
          return {
            ...state,
            activeTabBySession: { ...(state.activeTabBySession ?? {}), [owner]: event.tabId },
          }
        }
        return state
      }
      const bySession = { ...(state.activeTabBySession ?? {}) }
      if (event.tabId) bySession[state.activeSessionKey] = event.tabId
      return { ...state, activeTabId: event.tabId, activeTabBySession: bySession, ...('findResult' in state ? { findResult: null } : {}) }
    }
    case 'download-updated':
      return { ...state, downloads: { ...state.downloads, [event.download.id]: event.download } }
    case 'find-result':
      return { ...state, findResult: { tabId: event.tabId, active: event.active, matches: event.matches } }
    case 'agent-action':
      return { ...state, agentAction: event.action ? { tabId: event.tabId, action: event.action } : null }
    case 'agent-step': {
      const prevSteps = state.agentSteps ?? []
      const idx = prevSteps.findIndex((st) => st.id === event.step.id)
      const nextSteps =
        idx >= 0
          ? prevSteps.map((st, i) => (i === idx ? event.step : st))
          : [...prevSteps, event.step].slice(-MAX_AGENT_STEPS)
      return { ...state, agentSteps: nextSteps }
    }
    case 'help-request':
      return { ...state, helpRequests: { ...state.helpRequests, [event.request.id]: event.request } }
    case 'help-ended': {
      if (!state.helpRequests[event.id]) return state
      const helpRequests = { ...state.helpRequests }
      delete helpRequests[event.id]
      return { ...state, helpRequests }
    }
    default:
      return state
  }
}

type ShortcutAction = Extract<BrowserEvent, { type: 'shortcut' }>['action']
type ShortcutListener = (action: ShortcutAction) => void
const shortcutListeners = new Set<ShortcutListener>()

export function onBrowserShortcut(listener: ShortcutListener): () => void {
  shortcutListeners.add(listener)
  return () => {
    shortcutListeners.delete(listener)
  }
}

type Listener = (event: BrowserEvent) => void
const sideListeners = new Set<Listener>()
let subscribed = false

export const useBrowserStore = create<BrowserStoreState>((set, get) => ({
  tabs: {},
  order: [],
  activeTabId: null,
  downloads: {},
  helpRequests: {},
  bookmarks: [],
  bookmarksBarVisible: readBookmarksBarPref(),
  findResult: null,
  agentAction: null,
  agentSteps: [],
  hydrated: false,
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setBookmarksBarVisible: (visible) => {
    try {
      localStorage.setItem(BOOKMARKS_BAR_KEY, visible ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ bookmarksBarVisible: visible })
  },
  clearAgentSteps: () => set({ agentSteps: [] }),
  async hydrate() {
    ensureBrowserSubscription()
    if (get().hydrated) return
    set({ hydrated: true })
    try {
      const bm = (await ipcClient.invoke('browser.bookmarks.list').catch(() => ({ bookmarks: [] }))) as {
        bookmarks?: BrowserBookmark[]
      }
      set({ bookmarks: bm?.bookmarks ?? [] })
    } catch {
      /* ignore */
    }
  },
}))

/** Subscribe once to Main events and hydrate from the current tab list (idempotent). */
export function ensureBrowserSubscription(): void {
  if (subscribed) return
  subscribed = true
  onBrowserEvent((event) => {
    useBrowserStore.setState((s) => applyBrowserEvent(s, event))
    if (event.type === 'download') {
      if (event.state === 'completed') toast.success(i18n.t('browser:toast.downloaded', { name: event.fileName }))
      else if (event.state === 'interrupted') toast.error(i18n.t('browser:toast.downloadFailed', { name: event.fileName }))
    } else if (event.type === 'shortcut') {
      if (event.action === 'toggle-stage') useUIStore.getState().toggleBrowserStage()
      else for (const l of shortcutListeners) l(event.action)
    }
    for (const listener of sideListeners) listener(event)
  })
  let lastSessionFile = useUIStore.getState().historySessionFile
  useUIStore.subscribe((s) => {
    if (s.historySessionFile === lastSessionFile) return
    lastSessionFile = s.historySessionFile
    void browserActions.setSession(s.historySessionFile).catch(() => {})
  })
  void ipcClient
    .invoke('browser.tabs.list')
    .then((res: { tabs?: BrowserTabInfo[]; activeTabId?: string | null } | undefined) => {
      const tabs = res?.tabs ?? []
      useBrowserStore.setState((prev) => ({
        ...prev,
        tabs: Object.fromEntries(tabs.map((t) => [t.tabId, t])),
        order: tabs.map((t) => t.tabId),
        activeTabId: res?.activeTabId ?? tabs.at(-1)?.tabId ?? null,
      }))
    })
    .catch(() => {})
  void ipcClient
    .invoke('browser.help.list')
    .then((res: { requests?: BrowserHelpRequest[] } | undefined) => {
      useBrowserStore.setState({ helpRequests: Object.fromEntries((res?.requests ?? []).map((r) => [r.id, r])) })
    })
    .catch(() => {})
  void ipcClient
    .invoke('browser.downloads.list')
    .then((res: { downloads?: BrowserDownloadInfo[] } | undefined) => {
      useBrowserStore.setState({ downloads: Object.fromEntries((res?.downloads ?? []).map((d) => [d.id, d])) })
    })
    .catch(() => {})
  void ipcClient
    .invoke('browser.bookmarks.list')
    .then((res: { bookmarks?: BrowserBookmark[] } | undefined) => {
      useBrowserStore.setState({ bookmarks: res?.bookmarks ?? [] })
    })
    .catch(() => {})
}

export function onBrowserSideEvent(listener: Listener): () => void {
  sideListeners.add(listener)
  return () => sideListeners.delete(listener)
}

export const browserActions = {
  open: (url?: string, sessionKey?: string | null) =>
    ipcClient.invoke('browser.tabs.open', {
      ...(url ? { url } : {}),
      ...(sessionKey ? { sessionKey: normalizeBrowserSessionKey(sessionKey) } : {}),
    }),
  openTab: async (url?: string, opts?: { sessionKey?: string; pinned?: boolean }): Promise<BrowserTabInfo> => {
    const res = (await ipcClient.invoke('browser.tabs.open', {
      ...(url ? { url } : {}),
      ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
      ...(opts?.pinned ? { pinned: true } : {}),
    })) as { tab: BrowserTabInfo }
    useBrowserStore.setState((s) => applyBrowserEvent(s, { type: 'tab-updated', tab: res.tab }))
    return res.tab
  },
  close: (tabId: string) => ipcClient.invoke('browser.tabs.close', { tabId }),
  reopenClosed: async (): Promise<BrowserTabInfo | null> => {
    const res = (await ipcClient.invoke('browser.tabs.reopen')) as { tab?: BrowserTabInfo | null }
    return res?.tab ?? null
  },
  duplicate: async (tabId: string): Promise<BrowserTabInfo | null> => {
    const res = (await ipcClient.invoke('browser.tabs.duplicate', { tabId })) as { tab?: BrowserTabInfo | null }
    return res?.tab ?? null
  },
  reorder: async (order: string[]) => {
    useBrowserStore.setState({ order })
    await ipcClient.invoke('browser.tabs.reorder', { order }).catch(() => {})
  },
  focus: (tabId: string | null) => ipcClient.invoke('browser.tabs.focus', { tabId }),
  pin: (tabId: string, pinned: boolean) => ipcClient.invoke('browser.tabs.pin', { tabId, pinned }),
  mute: (tabId: string, muted: boolean) => ipcClient.invoke('browser.tabs.mute', { tabId, muted }),
  sleep: (tabId: string) => ipcClient.invoke('browser.tabs.sleep', { tabId }),
  setSession: (sessionKey: string | null | undefined) => {
    const resolvedKey = normalizeBrowserSessionKey(sessionKey)
    return ipcClient.invoke('browser.session.set', { sessionKey: resolvedKey })
  },
  adoptSession: (fromSessionKey: string | null | undefined, toSessionKey: string | null | undefined) => {
    const from = normalizeBrowserSessionKey(fromSessionKey)
    const to = normalizeBrowserSessionKey(toSessionKey)
    useBrowserStore.setState((s) => adoptBrowserSessionInState(s, from, to))
    return ipcClient.invoke('browser.tabs.adoptSession', { fromSessionKey: from, toSessionKey: to })
  },
  navigate: (tabId: string, url: string) => ipcClient.invoke('browser.navigate', { tabId, url }),
  history: (tabId: string, history: 'back' | 'forward' | 'reload' | 'stop') =>
    ipcClient.invoke('browser.navigate', { tabId, history }),
  hideAll: () => ipcClient.invoke('browser.hideAll'),
  find: (tabId: string, text: string, opts?: { forward?: boolean; findNext?: boolean }) =>
    ipcClient.invoke('browser.find', { tabId, text, ...opts }),
  stopFind: (tabId: string) => ipcClient.invoke('browser.find.stop', { tabId }),
  respondHelp: (id: string, outcome: 'completed' | 'cancelled') =>
    ipcClient.invoke('browser.help.respond', { id, outcome }),
  cancelDownload: (id: string) => ipcClient.invoke('browser.downloads.cancel', { id }),
  revealDownload: (id: string) => ipcClient.invoke('browser.downloads.reveal', { id }),
  openDownloadDir: () => ipcClient.invoke('browser.downloads.openDir'),
  clearDownloads: async () => {
    const res = (await ipcClient.invoke('browser.downloads.clear')) as { downloads?: BrowserDownloadInfo[] }
    useBrowserStore.setState({ downloads: Object.fromEntries((res?.downloads ?? []).map((d) => [d.id, d])) })
  },
  loadBookmarks: async () => {
    const res = (await ipcClient.invoke('browser.bookmarks.list')) as { bookmarks?: BrowserBookmark[] }
    useBrowserStore.getState().setBookmarks(res.bookmarks ?? [])
  },
  addBookmark: async (input: { url: string; title?: string; folder?: string; favicon?: string }) => {
    const res = (await ipcClient.invoke('browser.bookmarks.add', input)) as { bookmarks?: BrowserBookmark[] }
    useBrowserStore.getState().setBookmarks(res.bookmarks ?? [])
  },
  removeBookmark: async (idOrUrl: { id?: string; url?: string }) => {
    const res = (await ipcClient.invoke('browser.bookmarks.remove', idOrUrl)) as { bookmarks?: BrowserBookmark[] }
    useBrowserStore.getState().setBookmarks(res.bookmarks ?? [])
  },
  importHtmlBookmarks: async (html: string) => {
    const res = (await ipcClient.invoke('browser.bookmarks.importHtml', { html })) as {
      added: number
      bookmarks: BrowserBookmark[]
    }
    useBrowserStore.getState().setBookmarks(res.bookmarks ?? [])
    return res.added
  },
  abortAgent: () => ipcClient.invoke('browser.agent.abort') as Promise<{ aborted: number }>,
}
