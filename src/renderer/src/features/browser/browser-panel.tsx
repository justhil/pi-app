import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  browserSearchUrl,
  formatLogsForComposer,
  formatSelectionForComposer,
  normalizeAddressInput,
  type BrowserEvent,
  type BrowserLogEntry,
  type PageContextResult,
} from '@shared/browser-types'
import { ArrowLeft, ArrowRight, ChevronRight, Globe, History, Maximize2, MessageSquarePlus, Monitor, PencilLine, Plus, RefreshCw, Search, X } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { browserActions, ensureBrowserSubscription, onBrowserSideEvent, useBrowserStore } from './browser-store'
import { useOverlayCovering, useViewPlacement } from './use-view-placement'
import { AnnotationLayer } from './annotation-layer'
import { saveImageAttachment, sendToComposer } from './browser-composer'
import { buildSuggestions, type Suggestion } from './address-suggestions'
import { loadHistory, recordVisit, saveHistory, type HistoryEntry } from './browser-history'
import { clampViewport, fitViewport, loadViewportMode, saveViewportMode, type ViewportMode } from './viewport-mode'

const isMod = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey

export function BrowserPanel() {
  const { t } = useTranslation('browser')
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const tabStripRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)

  const tabs = useBrowserStore((s) => s.tabs)
  const order = useBrowserStore((s) => s.order)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const activeTab = activeTabId ? tabs[activeTabId] : undefined
  const pageShown = !!activeTab && activeTab.url !== 'about:blank'

  const activePanel = useUIStore((s) => s.activePanel)
  const browserChatExpand = useUIStore((s) => s.browserChatExpand)
  const rightPanelCollapsed = useRightPanelHidden()
  const revealRightPanel = useUIStore((s) => s.revealRightPanel)

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [viewportMode, setViewportModeState] = useState<ViewportMode>(loadViewportMode)
  const [viewportMenuOpen, setViewportMenuOpen] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [highlight, setHighlight] = useState(0)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [hiddenForOverlay, setHiddenForOverlay] = useState(false)
  const [searchUrl, setSearchUrl] = useState(() => browserSearchUrl(undefined))
  const [annotating, setAnnotating] = useState<{ snapshot: string; tabId: string } | null>(null)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [agentAction, setAgentAction] = useState<{ tabId: string; action: string } | null>(null)
  const covered = useOverlayCovering(viewportRef)

  useEffect(() => {
    ensureBrowserSubscription()
    // Settings live on another view; re-read on mount so a changed engine applies next time.
    void ipcClient
      .invoke('settings.get', { key: 'browserSearchEngine' })
      .then((res: { settings?: { browserSearchEngine?: string } } | undefined) => setSearchUrl(browserSearchUrl(res?.settings?.browserSearchEngine)))
      .catch(() => {})
  }, [])

  // Overlays (dialogs, menus) would sit under the native view: freeze a snapshot, then hide the view.
  useEffect(() => {
    if (!covered || !activeTabId || !pageShown) {
      setHiddenForOverlay(false)
      return
    }
    let cancelled = false
    void ipcClient
      .invoke('browser.capture', { tabId: activeTabId })
      .catch(() => null)
      .then((res: { dataUrl?: string | null } | null) => {
        if (cancelled) return
        setSnapshot(res?.dataUrl ?? null)
        setHiddenForOverlay(true)
      })
    return () => {
      cancelled = true
    }
  }, [covered, activeTabId, pageShown])

  const fitted = fitViewport(viewportMode, area)
  useViewPlacement(viewportRef, activeTabId, pageShown && !hiddenForOverlay && !annotating, fitted.zoom)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setArea({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const setViewportMode = (mode: ViewportMode) => {
    setViewportModeState(mode)
    saveViewportMode(mode)
  }

  // Remember finished page loads for address suggestions (this device only).
  useEffect(
    () =>
      onBrowserSideEvent((event) => {
        if (event.type !== 'tab-updated' || event.tab.loading || !/^https?:/i.test(event.tab.url)) return
        setHistory((prev) => {
          if (prev[0]?.url === event.tab.url && prev[0]?.title === event.tab.title) return prev
          const next = prev[0]?.url === event.tab.url ? [{ ...prev[0], title: event.tab.title || prev[0].title }, ...prev.slice(1)] : recordVisit(prev, event.tab.url, event.tab.title)
          saveHistory(next)
          return next
        })
      }),
    [],
  )

  // Tab strip: wheel scrolls sideways; the active tab stays in view.
  useEffect(() => {
    const strip = tabStripRef.current
    if (!strip) return
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToHorizontal(e, strip)
      if (dx === null) return
      e.preventDefault()
      strip.scrollLeft += dx
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [order.length > 0])
  useEffect(() => {
    if (!activeTabId) return
    tabStripRef.current?.querySelector<HTMLElement>(`[data-browser-tab="${CSS.escape(activeTabId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  const focusAddress = useCallback(() => {
    addressRef.current?.focus()
    addressRef.current?.select()
  }, [])

  const openTab = useCallback(
    async (url?: string) => {
      try {
        await browserActions.open(url)
        if (!url) requestAnimationFrame(focusAddress)
      } catch {
        toast.error(t('toast.navigateFailed'))
      }
    },
    [focusAddress, t],
  )

  const closeActive = useCallback(() => {
    if (activeTabId) void browserActions.close(activeTabId)
  }, [activeTabId])

  const suggestions: Suggestion[] = editing
    ? buildSuggestions(draft, { tabs: order.map((id) => tabs[id]).filter(Boolean), activeTabId, history, searchUrl })
    : []
  // The input still shows the current URL right after focus: no suggestions until the user types.
  const showSuggestions = editing && suggestions.length > 0 && draft !== (activeTab?.url ?? '')

  const go = useCallback(
    async (s: Suggestion | undefined) => {
      const url = s ? s.url : normalizeAddressInput(draft, searchUrl)
      setEditing(false)
      addressRef.current?.blur()
      if (url === 'about:blank') return
      try {
        if (s?.kind === 'tab') await browserActions.focus(s.tabId)
        else if (activeTabId) await browserActions.navigate(activeTabId, url)
        else await browserActions.open(url)
      } catch {
        toast.error(t('toast.navigateFailed'))
      }
    },
    [draft, searchUrl, activeTabId, t],
  )

  const toggleAnnotate = useCallback(async () => {
    if (annotating) {
      setAnnotating(null)
      return
    }
    if (!activeTabId || !pageShown) return
    const res = (await ipcClient.invoke('browser.capture', { tabId: activeTabId }).catch(() => null)) as { dataUrl?: string | null } | null
    if (res?.dataUrl) setAnnotating({ snapshot: res.dataUrl, tabId: activeTabId })
    else toast.error(t('annotate.captureFailed'))
  }, [annotating, activeTabId, pageShown, t])

  // A draft typed for one tab must not carry over to another (e.g. after closing a tab).
  useEffect(() => {
    if (document.activeElement !== addressRef.current) setEditing(false)
    else setDraft(pageShown ? (activeTab?.url ?? '') : '')
  }, [activeTabId])

  // Leave annotation mode when the tab changes or navigates away.
  useEffect(() => {
    if (annotating && annotating.tabId !== activeTabId) setAnnotating(null)
  }, [annotating, activeTabId])

  const sendAction = useCallback(
    async (kind: 'screenshot' | 'page' | 'selection' | 'logs') => {
      setSendMenuOpen(false)
      if (!activeTabId || !activeTab) return
      try {
        if (kind === 'screenshot') {
          const res = (await ipcClient.invoke('browser.capture', { tabId: activeTabId })) as { dataUrl?: string | null }
          if (!res?.dataUrl) throw new Error('capture failed')
          sendToComposer({ files: [await saveImageAttachment(res.dataUrl, `browser-${Date.now()}.jpg`)] })
        } else if (kind === 'page') {
          const res = (await ipcClient.invoke('browser.pageContext', { tabId: activeTabId, saveText: true })) as PageContextResult & { path: string | null }
          if (!res.path) throw new Error('page text unavailable')
          const name = `${(res.title || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'page'}.md`
          sendToComposer({ files: [{ path: res.path, name }] })
        } else if (kind === 'selection') {
          const res = (await ipcClient.invoke('browser.pageContext', { tabId: activeTabId })) as PageContextResult
          if (!res.selection) {
            toast.message(t('send.noSelection'))
            return
          }
          sendToComposer({ text: formatSelectionForComposer(res.url, res.selection) })
        } else {
          const res = (await ipcClient.invoke('browser.logs', { tabId: activeTabId })) as { entries: BrowserLogEntry[] }
          sendToComposer({
            text: formatLogsForComposer(activeTab.url, res.entries ?? [], {
              annotations: t('composer.annotations'),
              logs: t('composer.logs'),
              noLogs: t('composer.noLogs'),
              area: t('composer.area'),
              page: t('composer.page'),
              noComment: t('composer.noComment'),
            }),
          })
        }
      } catch (error) {
        console.warn('[browser] send to composer failed:', error)
        toast.error(t(String(error).includes('dialog_pending') ? 'send.dialogPending' : 'send.failed'))
      }
    },
    [activeTabId, activeTab, t],
  )

  // Shortcuts pressed while the page had focus arrive from Main; downloads surface as toasts.
  useEffect(
    () =>
      onBrowserSideEvent((event: BrowserEvent) => {
        if (event.type === 'agent-action') {
          setAgentAction(event.action ? { tabId: event.tabId, action: event.action } : null)
          return
        }
        if (event.type === 'shortcut') {
          if (event.action === 'focus-address') focusAddress()
          else if (event.action === 'new-tab') void openTab()
          else if (event.action === 'close-tab') closeActive()
          else if (event.action === 'annotate') void toggleAnnotate()
        } else if (event.type === 'download') {
          if (event.state === 'completed') toast.success(t('toast.downloaded', { name: event.fileName }), { description: event.savePath })
          else toast.error(t('toast.downloadFailed', { name: event.fileName }))
        }
      }),
    [focusAddress, openTab, closeActive, toggleAnnotate, t],
  )

  // Expanded mode belongs to this panel only; Esc returns to the side panel.
  useEffect(() => {
    if (activePanel !== 'browser') useUIStore.setState({ browserChatExpand: false })
  }, [activePanel])
  useEffect(() => () => { useUIStore.setState({ browserChatExpand: false }) }, [])
  useEffect(() => {
    if (!browserChatExpand) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], input')) return
      event.preventDefault()
      useUIStore.setState({ browserChatExpand: false })
      expandButtonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [browserChatExpand])

  const toggleExpand = () => {
    if (!browserChatExpand && rightPanelCollapsed) revealRightPanel()
    useUIStore.setState({ browserChatExpand: !browserChatExpand, filesPreviewChatExpand: false })
  }

  const onRootKeyDown = (e: ReactKeyboardEvent) => {
    if (!isMod(e) || e.altKey) return
    const key = e.key.toLowerCase()
    if (e.shiftKey) {
      if (key === 'a') {
        e.preventDefault()
        void toggleAnnotate()
      }
      return
    }
    if (key === 'l') focusAddress()
    else if (key === 't') void openTab()
    else if (key === 'w' && activeTabId) closeActive()
    else return
    e.preventDefault()
  }

  const addressValue = editing ? draft : pageShown ? (activeTab?.url ?? '') : ''
  const navButton = 'chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md disabled:opacity-40'
  const scaled = fitted.zoom < 0.999
  const viewportLabel =
    viewportMode.kind === 'fit'
      ? t('viewport.fit')
      : `${viewportMode.width}×${viewportMode.height}${scaled ? ` · ${Math.round(fitted.zoom * 100)}%` : ''}`
  // The tab row keeps the short form: the scale when scaled, else the size.
  const viewportShort = viewportMode.kind === 'fit' ? '' : scaled ? `${Math.round(fitted.zoom * 100)}%` : `${viewportMode.width}×${viewportMode.height}`

  // Esc closes the small menus of the toolbar.
  useEffect(() => {
    if (!viewportMenuOpen && !sendMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setViewportMenuOpen(false)
      setSendMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewportMenuOpen, sendMenuOpen])

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" onKeyDown={onRootKeyDown}>
      {/* Row 1: tabs (title space first), then how the page is sized and the expand toggle. */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/40 pl-1.5 pr-1">
        <div ref={tabStripRef} className="right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label={t('nav.tabs')}>
          {order.map((id) => {
            const tab = tabs[id]
            const active = id === activeTabId
            const label = tab?.title || (tab?.url !== 'about:blank' ? tab?.url : '') || t('tab.untitled')
            return (
              <div
                key={id}
                data-browser-tab={id}
                // Middle click closes, like every browser. Its defaults (autoscroll on mousedown,
                // X11 primary-selection paste on mouseup into the focused address bar) are blocked.
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onMouseUp={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  void browserActions.close(id)
                }}
                className={cn(
                  'group flex h-7 min-w-[56px] max-w-[180px] flex-1 basis-[160px] items-center gap-1 rounded-md pl-2 pr-0.5 text-[12px]',
                  active ? 'bg-[var(--bg-active)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--bg-hover)]',
                )}
              >
                {tab?.loading ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden /> : null}
                <button type="button" role="tab" aria-selected={active} className="min-w-0 flex-1 truncate text-left"
                  title={tab?.url} onClick={() => void browserActions.focus(id)}>
                  {label}
                </button>
                <button type="button" aria-label={t('nav.closeTab')} title={t('nav.closeTab')}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)] focus-visible:opacity-100',
                    active ? 'opacity-60' : 'opacity-0 group-hover:opacity-60',
                  )}
                  onClick={() => void browserActions.close(id)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          <button type="button" className={navButton} title={t('nav.newTab')} aria-label={t('nav.newTab')} onClick={() => void openTab()}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            className={cn('chrome-icon-btn flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] tabular-nums text-foreground-secondary', viewportMenuOpen && 'bg-[var(--bg-active)]')}
            title={`${t('viewport.title')}：${viewportLabel}`}
            aria-label={`${t('viewport.title')}：${viewportLabel}`}
            aria-haspopup="menu"
            aria-expanded={viewportMenuOpen}
            onClick={() => setViewportMenuOpen((o) => !o)}
          >
            {viewportMode.kind === 'fit' ? <Monitor className="h-3.5 w-3.5" /> : viewportShort}
          </button>
          {viewportMenuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setViewportMenuOpen(false)} aria-hidden />
              <div role="menu" aria-label={t('viewport.title')}
                className="absolute right-0 top-8 z-50 w-[220px] rounded-lg border border-border/60 bg-popover p-1 text-[12px] text-popover-foreground shadow-lg">
                <button type="button" role="menuitemradio" aria-checked={viewportMode.kind === 'fit'}
                  className={cn('flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]', viewportMode.kind === 'fit' && 'font-medium')}
                  onClick={() => { setViewportMode({ kind: 'fit' }); setViewportMenuOpen(false) }}>
                  {t('viewport.fit')}
                </button>
                <button type="button" role="menuitemradio" aria-checked={viewportMode.kind === 'fixed'}
                  className={cn('flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]', viewportMode.kind === 'fixed' && 'font-medium')}
                  onClick={() => viewportMode.kind === 'fit' && setViewportMode({ kind: 'fixed', width: 1280, height: 800 })}>
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
                          onBlur={(e) => setViewportMode({ kind: 'fixed', ...clampViewport(key === 'width' ? Number(e.target.value) : viewportMode.width, key === 'height' ? Number(e.target.value) : viewportMode.height) })}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="px-2 pb-1 text-[11px] leading-4 text-foreground-tertiary">{t('viewport.hint')}</div>
              </div>
            </>
          ) : null}
        </div>
        <button
          ref={expandButtonRef}
          type="button"
          className={cn('chrome-icon-btn flex h-7 shrink-0 items-center justify-center gap-1 rounded-md', browserChatExpand ? 'bg-[var(--bg-active)] px-2 text-[11px] text-foreground' : 'w-7')}
          title={browserChatExpand ? t('nav.collapse') : t('nav.expand')}
          aria-label={browserChatExpand ? t('nav.collapse') : t('nav.expand')}
          aria-expanded={browserChatExpand}
          onClick={toggleExpand}
        >
          {browserChatExpand ? <><ChevronRight className="h-3.5 w-3.5" /><span>{t('nav.collapse')}</span></> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Row 2: navigation, the address with suggestions, page actions. */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border/40 px-1.5">
        <button type="button" className={navButton} title={t('nav.back')} aria-label={t('nav.back')}
          disabled={!activeTab?.canGoBack} onClick={() => activeTabId && void browserActions.history(activeTabId, 'back')}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={navButton} title={t('nav.forward')} aria-label={t('nav.forward')}
          disabled={!activeTab?.canGoForward} onClick={() => activeTabId && void browserActions.history(activeTabId, 'forward')}>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={navButton}
          title={activeTab?.loading ? t('nav.stop') : t('nav.reload')}
          aria-label={activeTab?.loading ? t('nav.stop') : t('nav.reload')}
          disabled={!pageShown}
          onClick={() => activeTabId && void browserActions.history(activeTabId, activeTab?.loading ? 'stop' : 'reload')}>
          {activeTab?.loading ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        <div className="relative mx-1 min-w-0 flex-1">
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
            className="h-7 w-full rounded-md border border-transparent bg-[var(--bg-hover)] px-2.5 text-[12px] text-foreground outline-none placeholder:text-foreground-tertiary focus:border-ring focus:bg-background"
          />
          {showSuggestions ? (
            <div id="browser-address-suggestions" role="listbox" aria-label={t('address.suggestions')}
              className="absolute left-0 top-8 z-50 w-full min-w-[280px] overflow-hidden rounded-lg border border-border/60 bg-popover py-1 text-[12px] text-popover-foreground shadow-lg">
              {suggestions.map((s, i) => {
                const Icon = s.kind === 'search' ? Search : s.kind === 'history' ? History : Globe
                const primary = s.kind === 'search' ? t('address.search', { query: s.query }) : s.kind === 'open' ? t('address.open', { url: s.url }) : s.title || s.url
                const secondary = s.kind === 'tab' ? t('address.switchTab') : s.kind === 'history' ? s.url.replace(/^https?:\/\//, '') : ''
                return (
                  <div key={`${s.kind}-${s.url}`} role="option" aria-selected={i === highlight}
                    className={cn('flex cursor-default items-center gap-2 px-2.5 py-1.5', i === highlight && 'bg-[var(--bg-active)]')}
                    onMouseEnter={() => setHighlight(i)}
                    // mousedown, not click: the input's blur would close the list first.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void go(s)
                    }}>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
                    <span className="min-w-0 flex-1 truncate">{primary}</span>
                    {secondary ? <span className="ml-2 max-w-[45%] shrink-0 truncate text-[11px] text-foreground-tertiary">{secondary}</span> : null}
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
        <div className="relative">
          <button
            type="button"
            className={cn(navButton, sendMenuOpen && 'bg-[var(--bg-active)]')}
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
              <div role="menu" aria-label={t('send.menu')}
                className="absolute right-0 top-8 z-50 min-w-[190px] rounded-lg border border-border/60 bg-popover text-popover-foreground p-1 shadow-lg">
                {(['screenshot', 'page', 'selection', 'logs'] as const).map((kind) => (
                  <button key={kind} type="button" role="menuitem"
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    onClick={() => void sendAction(kind)}>
                    <span className="text-[12px] text-foreground">{t(`send.${kind}`)}</span>
                    <span className="text-[11px] text-foreground-tertiary">{t(`send.${kind}Desc`)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div ref={areaRef} className={cn('relative min-h-0 flex-1 overflow-hidden', viewportMode.kind === 'fixed' && 'bg-[var(--bg-hover)]')}>
      <div ref={viewportRef} className="absolute overflow-hidden" data-browser-viewport=""
        style={{ left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height }}>
        {agentAction && agentAction.tabId === activeTabId ? (
          <div className="pointer-events-none absolute right-2 top-2 z-30 flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-md" role="status">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
            {t('agent.acting', { action: agentAction.action })}
          </div>
        ) : null}
        {activeTab?.loading ? (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" aria-hidden />
        ) : null}
        {annotating && activeTab ? (
          <AnnotationLayer
            key={annotating.tabId}
            tabId={annotating.tabId}
            page={{ title: activeTab.title, url: activeTab.url }}
            initialSnapshot={annotating.snapshot}
            onExit={() => setAnnotating(null)}
          />
        ) : null}
        {pageShown && hiddenForOverlay && snapshot ? (
          <img src={snapshot} alt="" className="pointer-events-none h-full w-full object-cover object-left-top" />
        ) : null}
      </div>
      {!pageShown ? (
        <button type="button" onClick={focusAddress}
          className="absolute inset-0 flex items-center justify-center text-[12px] text-foreground-tertiary hover:text-foreground-secondary">
          {t('empty.title')}
        </button>
      ) : null}
      </div>
    </div>
  )
}
