import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  History,
  KeyRound,
  Maximize2,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Undo2,
  X,
  XCircle,
} from '@renderer/components/icons'
import {
  browserSearchUrl,
  formatLogsForComposer,
  normalizeAddressInput,
  type BrowserLogEntry,
  type BrowserTabInfo,
  type ComposerLabels,
  type PageContextResult,
} from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'

import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { isPanelVisibleInRightDock, useRightDockStore } from '@renderer/stores/right-dock-store'
import { SessionRunningPixelGrid } from '@renderer/features/workspace/session-running-pixel-grid'
import { AnnotationLayer } from './annotation-layer'
import { buildSuggestions, type Suggestion } from './address-suggestions'
import { saveImageAttachment, sendToComposer } from './browser-composer'
import { loadHistory, recordVisit, saveHistory, type HistoryEntry } from './browser-history'
import { BrowserNewTabPage } from './browser-new-tab'
import {
  browserActions,
  onBrowserShortcut,
  useBrowserStore,
  visibleTabsForSession,
} from './browser-store'
import { ChromeModeBanner } from './chrome-mode-banner'
import { createPortal } from 'react-dom'
import { CookieSyncDialog } from './cookie-sync-dialog'
import { FaviconImg } from './favicon-img'
import { DownloadsMenu } from './downloads-menu'
import { HelpBar } from './help-bar'
import { useOverlayCovering, useViewPlacement } from './use-view-placement'
import {
  clampViewport,
  fitViewport,
  loadViewportMode,
  saveViewportMode,
  type ViewportMode,
} from './viewport-mode'

const isMod = (e: { metaKey: boolean; ctrlKey: boolean }) =>
  window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

function nextZoom(current: number, delta: -1 | 0 | 1): number {
  if (delta === 0) return 1
  if (delta > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < current - 0.001) return ZOOM_STEPS[i]
  return ZOOM_STEPS[0]
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9.8 2.4 13.6 6.2 12.2 7.6 10.6 7 7.6 10 8.2 11.6 6.8 13 4.6 10.8 2 14l3.2-2.6L3 9.2 4.4 7.8 6 8.4 9 5.4 8.4 3.8Z" />
    </svg>
  )
}

function StarIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 1.8l1.85 3.75 4.14.6-3 2.92.71 4.12L8 11.24l-3.7 1.95.71-4.12-3-2.92 4.14-.6L8 1.8z" />
    </svg>
  )
}

function SpeakerIcon({ muted, className }: { muted?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2.5 6v4h2.8l3.2 2.6V3.4L5.3 6H2.5z" />
      {muted ? <path d="M11 6l3 4M14 6l-3 4" /> : <path d="M11 5.6a3.2 3.2 0 0 1 0 4.8M12.8 3.8a5.6 5.6 0 0 1 0 8.4" />}
    </svg>
  )
}

interface TabContextMenuState {
  tabId: string
  x: number
  y: number
}

interface BookmarkContextMenuState {
  id: string
  url: string
  title: string
  x: number
  y: number
}

export function BrowserPanel() {
  const { t } = useTranslation('browser')
  const tabs = useBrowserStore((s) => s.tabs)
  const rawOrder = useBrowserStore((s) => s.order)
  const rawActiveTabId = useBrowserStore((s) => s.activeTabId)
  const bookmarks = useBrowserStore((s) => s.bookmarks)
  const bookmarksBarVisible = useBrowserStore((s) => s.bookmarksBarVisible)
  const setBookmarksBarVisible = useBrowserStore((s) => s.setBookmarksBarVisible)
  const findResult = useBrowserStore((s) => s.findResult)
  const agentAction = useBrowserStore((s) => s.agentAction)
  const agentSteps = useBrowserStore((s) => s.agentSteps)
  const clearAgentSteps = useBrowserStore((s) => s.clearAgentSteps)
  const hydrate = useBrowserStore((s) => s.hydrate)

  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const activePanel = useUIStore((s) => s.activePanel)
  const rightPanelCollapsed = useRightPanelHidden()
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)
  const dockBottomTabs = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)

  const order = useMemo(() => visibleTabsForSession(tabs, rawOrder, historySessionFile), [tabs, rawOrder, historySessionFile])
  const activeTabId = rawActiveTabId && order.includes(rawActiveTabId) ? rawActiveTabId : (order.at(-1) ?? null)
  const activeTab = activeTabId ? tabs[activeTabId] : undefined
  const pageShown = !!activeTab && activeTab.url !== 'about:blank' && !activeTab.sleeping
  void activePanel
  void dockBottomTabs
  void dockTopActive
  void dockBottomActive
  const isStageActive = !rightPanelCollapsed && isPanelVisibleInRightDock('browser')

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [devServers, setDevServers] = useState<Array<{ url: string; label: string }>>([])
  const [searchUrl, setSearchUrl] = useState(browserSearchUrl(undefined))
  const [cachedSnapshot, setCachedSnapshot] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState<{ tabId: string; snapshot: string } | null>(null)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [stepsExpanded, setStepsExpanded] = useState(false)
  const [tabMenu, setTabMenu] = useState<TabContextMenuState | null>(null)
  const [bookmarkMenu, setBookmarkMenu] = useState<BookmarkContextMenuState | null>(null)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [userZoom, setUserZoom] = useState(1)
  const [viewportMode, setViewportModeState] = useState<ViewportMode>(loadViewportMode)
  const [area, setArea] = useState({ width: 0, height: 0 })

  const rootRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const tabStripRef = useRef<HTMLDivElement>(null)
  const importBookmarkInputRef = useRef<HTMLInputElement>(null)
  const recordedRef = useRef<Record<string, string>>({})

  const setViewportMode = (next: ViewportMode) => {
    setViewportModeState(next)
    saveViewportMode(next)
  }

  useEffect(() => {
    void hydrate()
    void ipcClient
      .invoke('settings.get', { key: 'browserSearchEngine' })
      .then((res: { settings?: { browserSearchEngine?: string } } | undefined) => {
        setSearchUrl(browserSearchUrl(res?.settings?.browserSearchEngine))
      })
      .catch(() => {})
    void (ipcClient.invoke('browser.devServers').catch(() => ({ servers: [] })) as Promise<{
      servers?: Array<{ url: string; label: string }>
    }>).then((res) => setDevServers(res?.servers ?? []))
  }, [hydrate])

  useEffect(() => {
    if (!activeTab || activeTab.loading || !activeTab.url || activeTab.url === 'about:blank' || activeTab.sleeping) return
    const key = `${activeTab.url}\0${activeTab.title}`
    if (recordedRef.current[activeTab.tabId] !== key) {
      recordedRef.current[activeTab.tabId] = key
      setHistory((prev) => {
        const next = recordVisit(prev, activeTab.url, activeTab.title)
        saveHistory(next)
        return next
      })
    }
    const timer = window.setTimeout(() => {
      void ipcClient
        .invoke('browser.capture', { tabId: activeTab.tabId })
        .then((res: { dataUrl?: string | null }) => {
          if (res?.dataUrl) setCachedSnapshot(res.dataUrl)
        })
        .catch(() => {})
    }, 280)
    return () => window.clearTimeout(timer)
  }, [activeTab])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setArea({ width: r.width, height: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const covered = useOverlayCovering(viewportRef)
  const viewMustHide = covered || !!annotating || !!tabMenu || !!bookmarkMenu || syncDialogOpen || sendMenuOpen || moreMenuOpen

  useEffect(() => {
    if (!viewMustHide || !activeTabId || !pageShown || cachedSnapshot) return
    void ipcClient
      .invoke('browser.capture', { tabId: activeTabId })
      .then((res: { dataUrl?: string | null }) => {
        if (res?.dataUrl) setCachedSnapshot(res.dataUrl)
      })
      .catch(() => {})
  }, [viewMustHide, activeTabId, pageShown, cachedSnapshot])

  useEffect(() => {
    setCachedSnapshot(null)
    if (annotating && annotating.tabId !== activeTabId) setAnnotating(null)
  }, [activeTabId, annotating])

  const fitted = fitViewport(viewportMode, area)
  const viewVisible = isStageActive && pageShown && !viewMustHide
  useViewPlacement(viewportRef, activeTabId, viewVisible, fitted.zoom * userZoom)

  useEffect(() => {
    if (!isStageActive) void browserActions.hideAll().catch(() => {})
  }, [isStageActive])

  const focusAddress = useCallback(() => {
    addressRef.current?.focus()
    addressRef.current?.select()
  }, [])

  const openTab = useCallback(
    async (url?: string) => {
      try {
        await browserActions.openTab(url)
        if (!url) requestAnimationFrame(() => focusAddress())
      } catch {
        toast.error(t('toast.navigateFailed'))
      }
    },
    [focusAddress, t],
  )

  const navigateOrOpen = useCallback(
    async (raw: string) => {
      const url = normalizeAddressInput(raw, searchUrl)
      if (!url || url === 'about:blank') return
      try {
        let id = activeTabId
        if (!id) {
          const created = await browserActions.openTab(url)
          id = created.tabId
        } else {
          await browserActions.navigate(id, url)
        }
        setEditing(false)
        addressRef.current?.blur()
      } catch {
        toast.error(t('toast.navigateFailed'))
      }
    },
    [activeTabId, searchUrl, t],
  )

  const suggestions = useMemo(
    () =>
      editing
        ? buildSuggestions(draft, {
            tabs: Object.values(tabs),
            activeTabId,
            bookmarks,
            devServers,
            history,
            searchUrl,
          })
        : [],
    [editing, draft, tabs, activeTabId, bookmarks, devServers, history, searchUrl],
  )
  const showSuggestions = editing && suggestions.length > 0

  const go = async (picked?: Suggestion) => {
    if (picked?.kind === 'tab') {
      setEditing(false)
      addressRef.current?.blur()
      void browserActions.focus(picked.tabId)
      return
    }
    const target = picked ? picked.url : normalizeAddressInput(draft, searchUrl)
    await navigateOrOpen(target)
  }

  const closeActive = useCallback(() => {
    if (activeTabId) void browserActions.close(activeTabId)
  }, [activeTabId])

  const reopenClosed = useCallback(async () => {
    const restored = await browserActions.reopenClosed()
    if (!restored) toast.info(t('nav.nothingToReopen'))
  }, [t])

  const toggleAnnotate = useCallback(async () => {
    if (annotating) return setAnnotating(null)
    if (!activeTabId || !pageShown) return
    const res = (await ipcClient.invoke('browser.capture', { tabId: activeTabId }).catch(() => null)) as {
      dataUrl?: string | null
    } | null
    if (!res?.dataUrl) return toast.error(t('annotate.captureFailed'))
    setCachedSnapshot(res.dataUrl)
    setAnnotating({ tabId: activeTabId, snapshot: res.dataUrl })
  }, [annotating, activeTabId, pageShown, t])

  const openFind = useCallback(() => {
    if (!pageShown) return
    setFindOpen(true)
    requestAnimationFrame(() => {
      findRef.current?.focus()
      findRef.current?.select()
    })
  }, [pageShown])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    if (activeTabId) void browserActions.stopFind(activeTabId)
  }, [activeTabId])

  const runFind = (text: string, opts?: { forward?: boolean; findNext?: boolean }) => {
    if (activeTabId) void browserActions.find(activeTabId, text, opts)
  }

  const zoom = useCallback((delta: -1 | 0 | 1) => setUserZoom((z) => nextZoom(z, delta)), [])

  useEffect(
    () =>
      onBrowserShortcut((action) => {
        if (!isStageActive) return
        if (action === 'focus-address') focusAddress()
        else if (action === 'new-tab') void openTab()
        else if (action === 'close-tab') closeActive()
        else if (action === 'reopen-tab') void reopenClosed()
        else if (action === 'annotate') void toggleAnnotate()
        else if (action === 'find') openFind()
        else if (action === 'zoom-in') zoom(1)
        else if (action === 'zoom-out') zoom(-1)
        else if (action === 'zoom-reset') zoom(0)
      }),
    [isStageActive, focusAddress, openTab, closeActive, reopenClosed, toggleAnnotate, openFind, zoom],
  )

  const onRootKeyDown = (e: ReactKeyboardEvent) => {
    if (!isMod(e) || e.altKey) return
    const key = e.key.toLowerCase()
    if (e.shiftKey && key === 'a') {
      e.preventDefault()
      void toggleAnnotate()
    } else if (e.shiftKey && key === 't') {
      e.preventDefault()
      void reopenClosed()
    } else if (e.shiftKey && (key === '+' || key === '=')) {
      e.preventDefault()
      zoom(1)
    } else if (!e.shiftKey && (key === 'l' || key === 'k')) {
      e.preventDefault()
      focusAddress()
    } else if (!e.shiftKey && key === 't') {
      e.preventDefault()
      void openTab()
    } else if (!e.shiftKey && key === 'w') {
      e.preventDefault()
      closeActive()
    } else if (!e.shiftKey && key === 'f') {
      e.preventDefault()
      openFind()
    } else if (!e.shiftKey && (key === '=' || key === '+')) {
      e.preventDefault()
      zoom(1)
    } else if (!e.shiftKey && key === '-') {
      e.preventDefault()
      zoom(-1)
    } else if (!e.shiftKey && key === '0') {
      e.preventDefault()
      zoom(0)
    }
  }

  const sendAction = async (kind: 'screenshot' | 'page' | 'selection' | 'logs') => {
    setSendMenuOpen(false)
    if (!activeTabId || !activeTab) return
    const labels: ComposerLabels = {
      annotations: t('composer.annotations'),
      logs: t('composer.logs'),
      noLogs: t('composer.noLogs'),
      area: t('composer.area'),
      page: t('composer.page'),
      noComment: t('composer.noComment'),
    }
    try {
      if (kind === 'screenshot') {
        const res = (await ipcClient.invoke('browser.capture', { tabId: activeTabId })) as { dataUrl?: string | null }
        if (!res?.dataUrl) return toast.error(t('annotate.captureFailed'))
        const file = await saveImageAttachment(res.dataUrl, `browser-${Date.now()}.jpg`)
        sendToComposer({ text: `${t('composer.page')}: ${activeTab.title || activeTab.url} (${activeTab.url})`, files: [file] })
      } else if (kind === 'logs') {
        const res = (await ipcClient.invoke('browser.logs', { tabId: activeTabId, max: 30 })) as { entries?: BrowserLogEntry[] }
        sendToComposer({ text: formatLogsForComposer(activeTab.url, res?.entries ?? [], labels) })
      } else {
        const ctx = (await ipcClient.invoke('browser.pageContext', { tabId: activeTabId, saveText: kind === 'page' })) as PageContextResult & { path?: string | null }
        if (kind === 'selection') {
          if (!ctx.selection) return toast.error(t('send.noSelection'))
          sendToComposer({
            text: `${t('composer.page')}: ${ctx.title || ctx.url} (${ctx.url})\n\n> ${ctx.selection.replace(/\n/g, '\n> ')}`,
          })
        } else if (ctx.path) {
          sendToComposer({
            text: `${t('composer.page')}: ${ctx.title || ctx.url} (${ctx.url})`,
            files: [{ path: ctx.path, name: `${(ctx.title || 'page').slice(0, 40)}.md` }],
          })
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(msg.includes('browser_dialog_pending') ? t('send.dialogPending') : t('send.failed'))
    }
  }

  const isBookmarked = Boolean(activeTab?.url && bookmarks.some((b) => b.url === activeTab.url))
  const toggleBookmark = async () => {
    if (!activeTab || !pageShown) return
    if (isBookmarked) {
      await browserActions.removeBookmark({ url: activeTab.url })
      toast.success(t('bookmarks.removed'))
    } else {
      await browserActions.addBookmark({
        url: activeTab.url,
        title: activeTab.title || activeTab.url,
        favicon: activeTab.favicon,
      })
      toast.success(t('bookmarks.added'))
    }
  }

  const handlePauseTakeover = async () => {
    const res = await browserActions.abortAgent().catch(() => ({ aborted: 0 }))
    toast.info(res.aborted > 0 ? t('agent.takeoverDone') : t('agent.takeoverReady'))
  }

  const handleTabDrop = (targetId: string) => {
    if (!dragTabId || dragTabId === targetId) return
    const next = order.filter((id) => id !== dragTabId)
    const idx = next.indexOf(targetId)
    if (idx < 0) return
    next.splice(idx, 0, dragTabId)
    setDragTabId(null)
    void browserActions.reorder(next)
  }

  const handleImportBookmarkHtml = async (file: File) => {
    try {
      const html = await file.text()
      const added = await browserActions.importHtmlBookmarks(html)
      toast.success(t('bookmarks.imported', { count: added }))
    } catch {
      toast.error(t('bookmarks.importFailed'))
    }
  }

  const openExternal = (url: string) => {
    if (!url || url === 'about:blank') return
    void ipcClient.invoke('desktop.openExternal', { url }).catch(() => window.open(url, '_blank', 'noopener'))
  }

  const addressValue = editing ? draft : pageShown ? (activeTab?.url ?? '').replace(/^https?:\/\//i, '') : ''
  const isHttps = Boolean(activeTab?.url?.startsWith('https://'))
  const isLocal = Boolean(activeTab?.url && /^http:\/\/(localhost|127\.0\.0\.1)/i.test(activeTab.url))
  const modKeyLabel = window.piDesktop?.platform === 'darwin' ? '⌘' : 'Ctrl+'
  const navButton =
    'chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:text-foreground disabled:opacity-35'

  const recentTabSteps = agentSteps.filter((st) => !activeTabId || st.tabId === activeTabId).slice(-8)
  const menuTab: BrowserTabInfo | null = tabMenu ? (tabs[tabMenu.tabId] ?? null) : null

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background" onKeyDown={onRootKeyDown}>
      {/* Row 1: Compact Browser Tab Bar inside RightDock pane */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-[var(--surface-sidebar)]/55 px-1.5">
        <div
          ref={tabStripRef}
          className="right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label={t('nav.tabs')}
        >
          {order.map((id) => {
            const tab = tabs[id]
            if (!tab) return null
            const active = id === activeTabId
            const pinned = !!tab.pinned
            const isAgentTab = tab.openedBy !== 'user'
            const label =
              tab.title || (tab.url !== 'about:blank' ? tab.url.replace(/^https?:\/\//i, '') : '') || t('tab.untitled')
            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDragTabId(id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleTabDrop(id)}
                onDragEnd={() => setDragTabId(null)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ tabId: id, x: e.clientX, y: e.clientY })
                }}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onMouseUp={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  void browserActions.close(id)
                }}
                data-browser-tab={id}
                data-pinned={pinned ? 'true' : undefined}
                className={cn(
                  'group flex h-7 min-w-[72px] max-w-[186px] flex-1 basis-[148px] items-center gap-1.5 rounded-md pl-2 pr-1 text-[11.5px] transition-colors',
                  active
                    ? 'bg-background font-medium text-foreground shadow-xs'
                    : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                  tab.sleeping && 'opacity-60',
                )}
              >
                {tab.loading ? (
                  <SessionRunningPixelGrid className="shrink-0" />
                ) : tab.sleeping ? (
                  <Moon className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FaviconImg src={tab.favicon} className="h-3.5 w-3.5 shrink-0" />
                )}

                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="min-w-0 flex-1 truncate text-left"
                  title={tab.url !== 'about:blank' ? `${label}\n${tab.url}` : label}
                  onClick={() => void browserActions.focus(id)}
                >
                  {label}
                </button>

                {isAgentTab ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" title={t('agent.openedByPi')} />
                ) : null}

                {tab.audible || tab.muted ? (
                  <button
                    type="button"
                    title={tab.muted ? t('tab.unmute') : t('tab.mute')}
                    aria-label={tab.muted ? t('tab.unmute') : t('tab.mute')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void browserActions.mute(id, !tab.muted)
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    <SpeakerIcon muted={tab.muted} className="h-3 w-3" />
                  </button>
                ) : null}

                {pinned ? (
                  <button
                    type="button"
                    title={t('nav.unpinTab')}
                    onClick={() => void browserActions.pin(id, false)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--brand)] hover:bg-[var(--bg-hover)]"
                  >
                    <PinIcon className="h-2.5 w-2.5" />
                  </button>
                ) : null}

                <button
                  type="button"
                  aria-label={t('nav.closeTab')}
                  title={t('nav.closeTab')}
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]',
                    active ? 'opacity-65 hover:opacity-100' : 'opacity-0 group-hover:opacity-65 hover:!opacity-100',
                  )}
                  onClick={() => void browserActions.close(id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className={navButton}
            title={`${t('nav.newTab')} (${modKeyLabel}T)`}
            aria-label={t('nav.newTab')}
            onClick={() => void openTab()}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

      </div>

      {/* Row 2: Modern Omnibox + AI Awareness + Design Mode Annotate + Send + Downloads + Cookie Sync */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/45 px-2">
        <button
          type="button"
          className={navButton}
          title={t('nav.back')}
          aria-label={t('nav.back')}
          disabled={!activeTab?.canGoBack}
          onClick={() => activeTabId && void browserActions.history(activeTabId, 'back')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={navButton}
          title={t('nav.forward')}
          aria-label={t('nav.forward')}
          disabled={!activeTab?.canGoForward}
          onClick={() => activeTabId && void browserActions.history(activeTabId, 'forward')}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={navButton}
          title={activeTab?.loading ? t('nav.stop') : t('nav.reload')}
          aria-label={activeTab?.loading ? t('nav.stop') : t('nav.reload')}
          disabled={!pageShown}
          onClick={() => activeTabId && void browserActions.history(activeTabId, activeTab?.loading ? 'stop' : 'reload')}
        >
          {activeTab?.loading ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>

        <div className="relative mx-0.5 flex min-w-0 flex-1 items-center">
          <span className="pointer-events-none absolute left-2 z-10 text-muted-foreground">
            {isLocal ? (
              <Terminal className="h-3 w-3 text-emerald-500" />
            ) : isHttps ? (
              <ShieldCheck className="h-3 w-3 opacity-65" />
            ) : (
              <Globe className="h-3 w-3 opacity-55" />
            )}
          </span>
          <input
            ref={addressRef}
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="browser-address-suggestions"
            aria-autocomplete="list"
            aria-label={t('address.label')}
            placeholder={t('address.placeholder')}
            value={addressValue}
            title={pageShown && !editing ? activeTab?.url : undefined}
            onFocus={(e) => {
              setDraft(pageShown ? (activeTab?.url ?? '') : '')
              setEditing(true)
              setHighlight(0)
              requestAnimationFrame(() => e.target.select())
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              setDraft(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!showSuggestions) return
                e.preventDefault()
                setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                void go(showSuggestions ? suggestions[highlight] : undefined)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
                e.currentTarget.blur()
              }
            }}
            className="h-7 w-full rounded-lg border border-transparent bg-[var(--bg-hover)] pl-6 pr-16 text-[12px] text-foreground outline-none placeholder:text-foreground-tertiary focus:border-ring focus:bg-background"
          />

          {pageShown && !editing ? (
            <div className="absolute right-1 flex items-center gap-0.5">
              <button
                type="button"
                title={isBookmarked ? t('bookmarks.remove') : t('bookmarks.add')}
                aria-label={isBookmarked ? t('bookmarks.remove') : t('bookmarks.add')}
                onClick={() => void toggleBookmark()}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-active)] hover:text-foreground',
                  isBookmarked && 'text-amber-500 hover:text-amber-500',
                )}
              >
                <StarIcon filled={isBookmarked} className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('address.copyUrl')}
                aria-label={t('address.copyUrl')}
                onClick={() => {
                  if (!activeTab?.url) return
                  void navigator.clipboard.writeText(activeTab.url)
                  toast.success(t('address.copiedUrl'))
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-active)] hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('address.openExternal')}
                aria-label={t('address.openExternal')}
                onClick={() => activeTab?.url && openExternal(activeTab.url)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-active)] hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          {showSuggestions ? (
            <div
              id="browser-address-suggestions"
              role="listbox"
              data-browser-overlay=""
              aria-label={t('address.suggestions')}
              className="absolute left-0 top-8 z-50 w-full min-w-[300px] overflow-hidden rounded-lg border border-border/70 bg-popover py-1 text-[12px] text-popover-foreground shadow-xl"
            >
              {suggestions.map((s, i) => {
                const Icon =
                  s.kind === 'search'
                    ? Search
                    : s.kind === 'history'
                      ? History
                      : s.kind === 'devserver'
                        ? Terminal
                        : Globe
                const primary =
                  s.kind === 'search'
                    ? t('address.search', { query: s.query })
                    : s.kind === 'open'
                      ? t('address.open', { url: s.url })
                      : s.title || s.url
                const badge =
                  s.kind === 'tab'
                    ? t('address.switchTab')
                    : s.kind === 'bookmark'
                      ? t('bookmarks.badge')
                      : s.kind === 'devserver'
                        ? 'DevServer'
                        : s.kind === 'history'
                          ? s.url.replace(/^https?:\/\//, '')
                          : ''
                return (
                  <div
                    key={`${s.kind}-${s.url}-${i}`}
                    role="option"
                    aria-selected={i === highlight}
                    className={cn(
                      'flex cursor-default items-center gap-2 px-2.5 py-1.5',
                      i === highlight && 'bg-[var(--bg-active)]',
                    )}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void go(s)
                    }}
                  >
                    {s.kind === 'bookmark' ? (
                      <StarIcon filled className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{primary}</span>
                    {badge ? (
                      <span className="ml-2 max-w-[42%] shrink-0 truncate text-[11px] text-foreground-tertiary">
                        {badge}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={cn(navButton, annotating && 'bg-[var(--bg-active)] text-foreground')}
          title={t('annotate.toggle')}
          aria-label={t('annotate.toggle')}
          aria-pressed={!!annotating}
          disabled={!pageShown}
          onClick={() => void toggleAnnotate()}
        >
          <PencilLine className="h-3.5 w-3.5" />
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            className={cn(navButton, sendMenuOpen && 'bg-[var(--bg-active)] text-foreground')}
            title={t('send.menu')}
            aria-label={t('send.menu')}
            aria-haspopup="menu"
            aria-expanded={sendMenuOpen}
            disabled={!pageShown || !!annotating}
            onClick={() => setSendMenuOpen((o) => !o)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          {sendMenuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSendMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                data-browser-overlay=""
                aria-label={t('send.menu')}
                className="absolute right-0 top-8 z-50 min-w-[205px] rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {(['screenshot', 'page', 'selection', 'logs'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    onClick={() => void sendAction(kind)}
                  >
                    <span className="text-[12px] text-foreground">{t(`send.${kind}`)}</span>
                    <span className="text-[11px] text-foreground-tertiary">{t(`send.${kind}Desc`)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {area.width >= 430 ? (
          <>
            <DownloadsMenu buttonClass={navButton} />
            <button
              type="button"
              className={navButton}
              title={t('sync.button')}
              aria-label={t('sync.button')}
              onClick={() => setSyncDialogOpen(true)}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={cn(navButton, browserChatExpand && 'bg-[var(--bg-active)] text-foreground')}
          title={browserChatExpand ? t('nav.collapseFromChat') : t('nav.expandOverChat')}
          aria-label={browserChatExpand ? t('nav.collapseFromChat') : t('nav.expandOverChat')}
          aria-pressed={browserChatExpand}
          onClick={() =>
            useUIStore.setState((s) => ({
              browserChatExpand: !s.browserChatExpand,
              filesPreviewChatExpand: false,
            }))
          }
        >
          {browserChatExpand ? (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M2.5 9.5h4v4M13.5 6.5h-4v-4M6.5 9.5l-4.5 4.5M9.5 6.5l4.5-4.5" />
            </svg>
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            className={cn(navButton, moreMenuOpen && 'bg-[var(--bg-active)] text-foreground')}
            title={t('nav.more')}
            aria-label={t('nav.more')}
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            onClick={() => setMoreMenuOpen((o) => !o)}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {moreMenuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                data-browser-overlay=""
                aria-label={t('nav.more')}
                className="absolute right-0 top-8 z-50 w-[236px] rounded-lg border border-border/60 bg-popover p-1 text-[12px] text-popover-foreground shadow-lg"
              >
                {area.width < 430 ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    onClick={() => {
                      setMoreMenuOpen(false)
                      setSyncDialogOpen(true)
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{t('sync.button')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    setBookmarksBarVisible(!bookmarksBarVisible)
                  }}
                >
                  <StarIcon filled={bookmarksBarVisible} className="h-3.5 w-3.5 text-amber-500" />
                  <span className="flex-1">
                    {bookmarksBarVisible ? t('bookmarks.hideBar') : t('bookmarks.showBar')}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    importBookmarkInputRef.current?.click()
                  }}
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{t('bookmarks.importHtml')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    void reopenClosed()
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{t('nav.reopenTab')}</span>
                  <span className="text-[10.5px] text-muted-foreground">{modKeyLabel}Shift+T</span>
                </button>
                <div className="my-1 h-px bg-border/60" role="separator" />
                <div className="px-2 pb-0.5 pt-1 text-[11px] text-foreground-tertiary">{t('viewport.title')}</div>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={viewportMode.kind === 'fit'}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]',
                    viewportMode.kind === 'fit' && 'font-medium',
                  )}
                  onClick={() => {
                    setViewportMode({ kind: 'fit' })
                    setMoreMenuOpen(false)
                  }}
                >
                  {t('viewport.fit')}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={viewportMode.kind === 'fixed'}
                  className={cn(
                    'flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]',
                    viewportMode.kind === 'fixed' && 'font-medium',
                  )}
                  onClick={() =>
                    viewportMode.kind === 'fit' && setViewportMode({ kind: 'fixed', width: 1280, height: 800 })
                  }
                >
                  {t('viewport.fixed')}
                </button>
                {viewportMode.kind === 'fixed' ? (
                  <div className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
                    {(['width', 'height'] as const).map((key, i) => (
                      <label key={key} className="flex items-center gap-1">
                        {i > 0 ? <span className="text-foreground-tertiary">×</span> : null}
                        <input
                          type="number"
                          aria-label={t(`viewport.${key}`)}
                          defaultValue={viewportMode[key]}
                          min={key === 'width' ? 320 : 240}
                          className="h-6 w-[68px] rounded border border-border/50 bg-transparent px-1.5 tabular-nums outline-none focus:border-ring"
                          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                          onBlur={(e) =>
                            setViewportMode({
                              kind: 'fixed',
                              ...clampViewport(
                                key === 'width' ? Number(e.target.value) : viewportMode.width,
                                key === 'height' ? Number(e.target.value) : viewportMode.height,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                {userZoom !== 1 ? (
                  <>
                    <div className="my-1 h-px bg-border/60" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                      onClick={() => {
                        zoom(0)
                        setMoreMenuOpen(false)
                      }}
                    >
                      <span>{t('zoom.reset')}</span>
                      <span className="font-mono text-[11px]">{Math.round(userZoom * 100)}%</span>
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <input
        ref={importBookmarkInputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleImportBookmarkHtml(file)
        }}
      />

      {pageShown && bookmarksBarVisible && bookmarks.length > 0 ? (
        <div
          data-pi-slot="browser-bookmarks-bar"
          className="right-panel-tabs-scroll flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 bg-[var(--bg-1)]/35 px-2 text-[11.5px]"
        >
          {bookmarks.slice(0, 24).map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.url}
              onClick={() => void navigateOrOpen(b.url)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void openTab(b.url)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setBookmarkMenu({ id: b.id, url: b.url, title: b.title, x: e.clientX, y: e.clientY })
              }}
              className="inline-flex h-5 max-w-[140px] shrink-0 items-center gap-1 rounded px-1.5 text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <FaviconImg src={b.favicon} className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Independent HUD above WebContentsView (never occluded by native page layer) */}
      <div className="relative h-[2px] w-full shrink-0 overflow-hidden bg-transparent">
        {activeTab?.loading ? <div className="h-full w-full animate-pulse bg-[var(--brand)]" /> : null}
      </div>

      {agentAction || recentTabSteps.length > 0 ? (
        <div
          data-pi-slot="browser-agent-hud"
          className="shrink-0 border-b border-border/50 bg-[var(--brand)]/[0.05] px-3 py-1.5 text-[11.5px]"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStepsExpanded((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {agentAction ? (
                <SessionRunningPixelGrid />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              )}
              <span className="truncate font-medium text-foreground">
                {agentAction
                  ? t('agent.acting', { action: agentAction.action })
                  : t('agent.recentSteps', { count: recentTabSteps.length })}
              </span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                  stepsExpanded && 'rotate-180',
                )}
              />
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {agentAction ? (
                <button
                  type="button"
                  onClick={() => void handlePauseTakeover()}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-[var(--bg-hover)]"
                >
                  <span>{t('agent.takeover')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={clearAgentSteps}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  {t('downloads.clear')}
                </button>
              )}
            </div>
          </div>

          {stepsExpanded && recentTabSteps.length > 0 ? (
            <div className="mt-1.5 flex max-h-[110px] flex-col gap-0.5 overflow-y-auto border-t border-border/40 pt-1.5 font-mono text-[11px]">
              {recentTabSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-1.5 text-foreground-secondary">
                  {step.status === 'running' ? (
                    <SessionRunningPixelGrid className="scale-75" />
                  ) : step.status === 'error' ? (
                    <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                  )}
                  <span className="truncate">{step.action}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab?.loadError ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-[12px]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate text-foreground">
              {t('error.loadFailed', { reason: activeTab.loadError.description })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => activeTabId && void browserActions.history(activeTabId, 'reload')}
              className="rounded-md border border-border bg-background px-2 py-0.5 text-foreground hover:bg-[var(--bg-hover)]"
            >
              {t('nav.reload')}
            </button>
            <button
              type="button"
              onClick={() =>
                sendToComposer({
                  text: t('error.askPiPrompt', {
                    url: activeTab.loadError!.url,
                    reason: activeTab.loadError!.description,
                  }),
                })
              }
              className="rounded-md bg-foreground px-2 py-0.5 font-medium text-background hover:opacity-90"
            >
              {t('error.askPi')}
            </button>
          </div>
        </div>
      ) : null}

      {findOpen ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/40 px-2" role="search">
          <input
            ref={findRef}
            value={findText}
            aria-label={t('find.label')}
            placeholder={t('find.placeholder')}
            onChange={(e) => {
              setFindText(e.target.value)
              runFind(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runFind(findText, { forward: !e.shiftKey, findNext: true })
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeFind()
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md bg-[var(--bg-hover)] px-2.5 text-[12px] outline-none placeholder:text-foreground-tertiary focus:bg-background focus:ring-1 focus:ring-ring"
          />
          <span className="w-14 shrink-0 text-center text-[11px] tabular-nums text-foreground-tertiary" aria-live="polite">
            {findText && findResult ? (findResult.matches ? `${findResult.active}/${findResult.matches}` : t('find.none')) : ''}
          </span>
          <button
            type="button"
            className={navButton}
            aria-label={t('find.prev')}
            disabled={!findResult?.matches}
            onClick={() => runFind(findText, { forward: false, findNext: true })}
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-180" />
          </button>
          <button
            type="button"
            className={navButton}
            aria-label={t('find.next')}
            disabled={!findResult?.matches}
            onClick={() => runFind(findText, { forward: true, findNext: true })}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={navButton} aria-label={t('find.close')} onClick={closeFind}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <HelpBar activeTabId={activeTabId} where="builtin" />
      <ChromeModeBanner />

      <div
        ref={areaRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          viewportMode.kind === 'fixed' && 'bg-[var(--bg-hover)]',
        )}
      >
        <div
          ref={viewportRef}
          className="absolute overflow-hidden"
          data-browser-viewport=""
          style={{ left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height }}
        >
          {annotating && activeTab ? (
            <AnnotationLayer
              key={annotating.tabId}
              tabId={annotating.tabId}
              page={{ title: activeTab.title, url: activeTab.url }}
              initialSnapshot={annotating.snapshot}
              onExit={() => setAnnotating(null)}
            />
          ) : null}
          {pageShown && viewMustHide && !annotating && cachedSnapshot ? (
            <img
              src={cachedSnapshot}
              alt=""
              className="pointer-events-none h-full w-full object-cover object-left-top"
            />
          ) : null}
        </div>

        {!pageShown ? (
          <BrowserNewTabPage
            bookmarks={bookmarks}
            history={history}
            onNavigate={(raw) => void navigateOrOpen(raw)}
            onRemoveHistory={(url) => {
              setHistory((prev) => {
                const next = prev.filter((item) => item.url !== url)
                saveHistory(next)
                return next
              })
            }}
            onOpenSync={() => setSyncDialogOpen(true)}
            onReopenClosed={() => void reopenClosed()}
          />
        ) : null}
      </div>

      {tabMenu && menuTab && typeof document !== 'undefined'
        ? createPortal(
            <>
          <div className="fixed inset-0 z-[110]" onClick={() => setTabMenu(null)} aria-hidden />
          <div
            role="menu"
            data-browser-overlay=""
            style={{
              left: Math.min(tabMenu.x, window.innerWidth - 200),
              top: Math.min(tabMenu.y, window.innerHeight - 280),
            }}
            className="fixed z-[120] w-[190px] rounded-lg border border-border/70 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                void browserActions.history(menuTab.tabId, 'reload')
              }}
            >
              {t('nav.reload')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                void browserActions.duplicate(menuTab.tabId)
              }}
            >
              {t('tab.duplicate')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                void browserActions.pin(menuTab.tabId, !menuTab.pinned)
              }}
            >
              {menuTab.pinned ? t('nav.unpinTab') : t('nav.pinTab')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                void browserActions.mute(menuTab.tabId, !menuTab.muted)
              }}
            >
              {menuTab.muted ? t('tab.unmute') : t('tab.mute')}
            </button>
            {menuTab.tabId !== activeTabId && !menuTab.sleeping ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setTabMenu(null)
                  void browserActions.sleep(menuTab.tabId)
                }}
              >
                {t('tab.sleep')}
              </button>
            ) : null}
            <div className="my-1 h-px bg-border/60" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                if (menuTab.url) {
                  void navigator.clipboard.writeText(menuTab.url)
                  toast.success(t('address.copiedUrl'))
                }
              }}
            >
              {t('address.copyUrl')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                openExternal(menuTab.url)
              }}
            >
              {t('address.openExternal')}
            </button>
            <div className="my-1 h-px bg-border/60" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                for (const otherId of order) {
                  if (otherId !== menuTab.tabId) void browserActions.close(otherId)
                }
              }}
            >
              {t('tab.closeOthers')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setTabMenu(null)
                const idx = order.indexOf(menuTab.tabId)
                if (idx >= 0) {
                  for (const rightId of order.slice(idx + 1)) void browserActions.close(rightId)
                }
              }}
            >
              {t('tab.closeRight')}
            </button>
          </div>
        </>,
            document.body,
          )
        : null}

      {bookmarkMenu && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[110]" onClick={() => setBookmarkMenu(null)} aria-hidden />
              <div
                role="menu"
                data-browser-overlay=""
                style={{
                  left: Math.min(bookmarkMenu.x, window.innerWidth - 185),
                  top: Math.min(bookmarkMenu.y, window.innerHeight - 140),
                }}
                className="fixed z-[120] w-[176px] rounded-lg border border-border/70 bg-popover p-1 text-[12px] text-popover-foreground shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    const url = bookmarkMenu.url
                    setBookmarkMenu(null)
                    void openTab(url)
                  }}
                >
                  {t('bookmarks.openInNewTab')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    const url = bookmarkMenu.url
                    setBookmarkMenu(null)
                    void navigator.clipboard.writeText(url)
                    toast.success(t('address.copiedUrl'))
                  }}
                >
                  {t('address.copyUrl')}
                </button>
                <div className="my-1 h-px bg-border/60" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    const id = bookmarkMenu.id
                    setBookmarkMenu(null)
                    void browserActions.removeBookmark({ id })
                    toast.success(t('bookmarks.removed'))
                  }}
                >
                  {t('bookmarks.remove')}
                </button>
              </div>
            </>,
            document.body,
          )
        : null}

      <CookieSyncDialog open={syncDialogOpen} onClose={() => setSyncDialogOpen(false)} />
    </div>
  )
}
