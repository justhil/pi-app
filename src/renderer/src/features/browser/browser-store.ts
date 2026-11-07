import { create } from 'zustand'
import {
  isTabVisibleInSession,
  normalizeBrowserSessionKey,
  type BrowserDownloadInfo,
  type BrowserEvent,
  type BrowserHelpRequest,
  type BrowserTabInfo,
} from '@shared/browser-types'
import { ipcClient, onBrowserEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export interface BrowserState {
  tabs: Record<string, BrowserTabInfo>
  order: string[]
  activeTabId: string | null
  /** Active tab remembered per conversation key. */
  activeTabBySession?: Record<string, string>
  /** Currently bound conversation key in the browser panel. */
  activeSessionKey?: string
  downloads: Record<string, BrowserDownloadInfo>
  /** The agent waiting on the user (browser_request_help), by request id. */
  helpRequests: Record<string, BrowserHelpRequest>
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

/** Pick the tab that should be shown for `sessionKey` (remembered → own tab → pinned tab → null). */
export function activeTabForSession(
  state: BrowserState,
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
export function switchBrowserSession(
  state: BrowserState,
  sessionKey: string | null | undefined,
): BrowserState {
  const nextKey = normalizeBrowserSessionKey(sessionKey)
  const bySession = { ...(state.activeTabBySession ?? {}) }
  if (state.activeSessionKey && state.activeTabId && state.tabs[state.activeTabId]) {
    if (isTabVisibleInSession(state.tabs[state.activeTabId], state.activeSessionKey)) {
      bySession[state.activeSessionKey] = state.activeTabId
    }
  }
  const nextState: BrowserState = {
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
export function adoptBrowserSessionInState(
  state: BrowserState,
  fromSessionKey: string | null | undefined,
  toSessionKey: string | null | undefined,
): BrowserState {
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
export function applyBrowserEvent(state: BrowserState, event: BrowserEvent): BrowserState {
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
      if (!state.activeSessionKey && !state.activeTabBySession) {
        return {
          ...state,
          tabs,
          order,
          activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
        }
      }
      const bySession = { ...(state.activeTabBySession ?? {}) }
      for (const [k, v] of Object.entries(bySession)) {
        if (v === event.tabId) delete bySession[k]
      }
      const base: BrowserState = { ...state, tabs, order, activeTabBySession: bySession }
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
        return { ...state, activeTabId: event.tabId }
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
      return { ...state, activeTabId: event.tabId, activeTabBySession: bySession }
    }
    case 'download-updated':
      return { ...state, downloads: { ...state.downloads, [event.download.id]: event.download } }
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

export const useBrowserStore = create<BrowserState>(() => ({ tabs: {}, order: [], activeTabId: null, downloads: {}, helpRequests: {} }))

type Listener = (event: BrowserEvent) => void
const sideListeners = new Set<Listener>()
let subscribed = false

/** Subscribe once to Main events and hydrate from the current tab list (idempotent). */
export function ensureBrowserSubscription(): void {
  if (subscribed) return
  subscribed = true
  onBrowserEvent((event) => {
    useBrowserStore.setState((s) => applyBrowserEvent(s, event))
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
      const currentSession = useUIStore.getState().historySessionFile
      useBrowserStore.setState((prev) =>
        switchBrowserSession(
          {
            ...prev,
            tabs: Object.fromEntries(tabs.map((t) => [t.tabId, t])),
            order: tabs.map((t) => t.tabId),
            activeTabId: res?.activeTabId ?? null,
          },
          currentSession,
        ),
      )
      void ipcClient
        .invoke('browser.session.set', { sessionKey: normalizeBrowserSessionKey(currentSession) })
        .catch(() => {})
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
}

/** Download / shortcut events that the panel reacts to but the store does not keep. */
export function onBrowserSideEvent(listener: Listener): () => void {
  sideListeners.add(listener)
  return () => sideListeners.delete(listener)
}

export const browserActions = {
  open: (url?: string, sessionKey?: string | null) => {
    const resolvedKey = normalizeBrowserSessionKey(
      sessionKey !== undefined ? sessionKey : useUIStore.getState().historySessionFile,
    )
    return ipcClient.invoke('browser.tabs.open', {
      ...(url ? { url } : {}),
      sessionKey: resolvedKey,
    })
  },
  close: (tabId: string) => ipcClient.invoke('browser.tabs.close', { tabId }),
  focus: (tabId: string | null) => ipcClient.invoke('browser.tabs.focus', { tabId }),
  pin: (tabId: string, pinned: boolean) => ipcClient.invoke('browser.tabs.pin', { tabId, pinned }),
  setSession: (sessionKey: string | null | undefined) => {
    const resolvedKey = normalizeBrowserSessionKey(sessionKey)
    useBrowserStore.setState((s) => switchBrowserSession(s, resolvedKey))
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
  respondHelp: (id: string, outcome: 'completed' | 'cancelled') => ipcClient.invoke('browser.help.respond', { id, outcome }),
  cancelDownload: (id: string) => ipcClient.invoke('browser.downloads.cancel', { id }),
  revealDownload: (id: string) => ipcClient.invoke('browser.downloads.reveal', { id }),
  clearDownloads: async () => {
    const res = (await ipcClient.invoke('browser.downloads.clear')) as { downloads?: BrowserDownloadInfo[] }
    useBrowserStore.setState({ downloads: Object.fromEntries((res?.downloads ?? []).map((d) => [d.id, d])) })
  },
}
