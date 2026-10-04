import { create } from 'zustand'
import type { BrowserDownloadInfo, BrowserEvent, BrowserTabInfo } from '@shared/browser-types'
import { ipcClient, onBrowserEvent } from '@renderer/lib/ipc-client'

export interface BrowserState {
  tabs: Record<string, BrowserTabInfo>
  order: string[]
  activeTabId: string | null
  downloads: Record<string, BrowserDownloadInfo>
}

/** Pure reducer for Main → Renderer browser events (unit-tested). */
export function applyBrowserEvent(state: BrowserState, event: BrowserEvent): BrowserState {
  switch (event.type) {
    case 'tab-updated': {
      const exists = !!state.tabs[event.tab.tabId]
      return {
        ...state,
        tabs: { ...state.tabs, [event.tab.tabId]: event.tab },
        order: exists ? state.order : [...state.order, event.tab.tabId],
      }
    }
    case 'tab-closed': {
      if (!state.tabs[event.tabId]) return state
      const tabs = { ...state.tabs }
      delete tabs[event.tabId]
      return {
        ...state,
        tabs,
        order: state.order.filter((id) => id !== event.tabId),
        activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
      }
    }
    case 'tab-focused':
      return { ...state, activeTabId: event.tabId }
    case 'download-updated':
      return { ...state, downloads: { ...state.downloads, [event.download.id]: event.download } }
    default:
      return state
  }
}

export const useBrowserStore = create<BrowserState>(() => ({ tabs: {}, order: [], activeTabId: null, downloads: {} }))

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
  void ipcClient
    .invoke('browser.tabs.list')
    .then((res: { tabs?: BrowserTabInfo[]; activeTabId?: string | null } | undefined) => {
      const tabs = res?.tabs ?? []
      useBrowserStore.setState({
        tabs: Object.fromEntries(tabs.map((t) => [t.tabId, t])),
        order: tabs.map((t) => t.tabId),
        activeTabId: res?.activeTabId ?? null,
      })
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
  open: (url?: string) => ipcClient.invoke('browser.tabs.open', url ? { url } : {}),
  close: (tabId: string) => ipcClient.invoke('browser.tabs.close', { tabId }),
  focus: (tabId: string) => ipcClient.invoke('browser.tabs.focus', { tabId }),
  navigate: (tabId: string, url: string) => ipcClient.invoke('browser.navigate', { tabId, url }),
  history: (tabId: string, history: 'back' | 'forward' | 'reload' | 'stop') =>
    ipcClient.invoke('browser.navigate', { tabId, history }),
  cancelDownload: (id: string) => ipcClient.invoke('browser.downloads.cancel', { id }),
  revealDownload: (id: string) => ipcClient.invoke('browser.downloads.reveal', { id }),
  clearDownloads: async () => {
    const res = (await ipcClient.invoke('browser.downloads.clear')) as { downloads?: BrowserDownloadInfo[] }
    useBrowserStore.setState({ downloads: Object.fromEntries((res?.downloads ?? []).map((d) => [d.id, d])) })
  },
}
