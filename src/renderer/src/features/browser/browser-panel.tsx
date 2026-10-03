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
import { ArrowLeft, ArrowRight, ChevronRight, Globe, Maximize2, MessageSquarePlus, PencilLine, Plus, RefreshCw, X } from '@renderer/components/icons'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { browserActions, ensureBrowserSubscription, onBrowserSideEvent, useBrowserStore } from './browser-store'
import { useOverlayCovering, useViewPlacement } from './use-view-placement'
import { AnnotationLayer } from './annotation-layer'
import { saveImageAttachment, sendToComposer } from './browser-composer'

/** Below this panel width the tab strip collapses into a select. */
const NARROW_PANEL_PX = 360

const isMod = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey

export function BrowserPanel() {
  const { t } = useTranslation('browser')
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
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
  const [narrow, setNarrow] = useState(false)
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

  useViewPlacement(viewportRef, activeTabId, pageShown && !hiddenForOverlay && !annotating)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_PANEL_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  const submitAddress = useCallback(async () => {
    const url = normalizeAddressInput(draft, searchUrl)
    setEditing(false)
    addressRef.current?.blur()
    if (url === 'about:blank') return
    try {
      if (activeTabId) await browserActions.navigate(activeTabId, url)
      else await browserActions.open(url)
    } catch {
      toast.error(t('toast.navigateFailed'))
    }
  }, [draft, searchUrl, activeTabId, t])

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

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" onKeyDown={onRootKeyDown}>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
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
        <input
          ref={addressRef}
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          aria-label={t('address.label')}
          placeholder={t('address.placeholder')}
          value={addressValue}
          onFocus={(e) => {
            setDraft(pageShown ? (activeTab?.url ?? '') : '')
            setEditing(true)
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submitAddress()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-foreground-tertiary focus:border-ring"
        />
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
        <button type="button" className={navButton} title={t('nav.newTab')} aria-label={t('nav.newTab')} onClick={() => void openTab()}>
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          ref={expandButtonRef}
          type="button"
          className={cn(
            'chrome-icon-btn flex h-7 shrink-0 items-center justify-center gap-1 rounded-md',
            browserChatExpand ? 'bg-[var(--bg-active)] px-2 text-[11px] text-foreground' : 'w-7',
          )}
          title={browserChatExpand ? t('nav.collapse') : t('nav.expand')}
          aria-label={browserChatExpand ? t('nav.collapse') : t('nav.expand')}
          aria-expanded={browserChatExpand}
          onClick={toggleExpand}
        >
          {browserChatExpand ? <><ChevronRight className="h-3.5 w-3.5" /><span>{t('nav.collapse')}</span></> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {order.length > 1 ? (
        narrow ? (
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
            <select
              aria-label={t('nav.tabs')}
              className="h-6 min-w-0 flex-1 rounded border border-border/50 bg-transparent px-1 text-[12px] text-foreground"
              value={activeTabId ?? ''}
              onChange={(e) => void browserActions.focus(e.target.value)}
            >
              {order.map((id) => (
                <option key={id} value={id}>{tabs[id]?.title || tabs[id]?.url || t('tab.untitled')}</option>
              ))}
            </select>
            <button type="button" className={navButton} title={t('nav.closeTab')} aria-label={t('nav.closeTab')} onClick={closeActive}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 px-2" role="tablist" aria-label={t('nav.tabs')}>
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
                    'group flex h-6 max-w-[180px] min-w-[72px] shrink-0 items-center gap-1 rounded-md pl-2 pr-0.5 text-[11.5px]',
                    active ? 'bg-[var(--bg-active)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <button type="button" role="tab" aria-selected={active} className="min-w-0 flex-1 truncate text-left"
                    title={tab?.url} onClick={() => void browserActions.focus(id)}>
                    {tab?.loading ? t('tab.loading') : label}
                  </button>
                  <button type="button" aria-label={t('nav.closeTab')} title={t('nav.closeTab')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void browserActions.close(id)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )
      ) : null}

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden" data-browser-viewport="">
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
        {!pageShown ? (
          <EmptyState title={t('empty.title')} description={t('empty.description')} className="h-full">
            <Globe className="h-5 w-5 text-foreground-tertiary" />
          </EmptyState>
        ) : hiddenForOverlay && snapshot ? (
          <img src={snapshot} alt="" className="pointer-events-none h-full w-full object-cover object-left-top" />
        ) : null}
      </div>
    </div>
  )
}
