import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Columns2, MessageSquarePlus, Plus, Terminal as TerminalIcon, X } from '@renderer/components/icons'
import { sendToComposer } from '@renderer/features/browser/browser-composer'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { loadProfiles, spawnPane } from './terminal-bridge'
import { disposeTerminalInstance, onTerminalSelection, TerminalPane, terminalSelection, useClosePane } from './terminal-pane'
import { MAX_PANES, MIN_TERMINAL_H, tabTitle, terminalActions, useTerminalStore, type ShellProfile, type TerminalTab } from './terminal-store'

const isToggleKey = (e: KeyboardEvent) => e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'Backquote' || e.key === '`')

/** Open a new tab with a shell (default: pi's), in the current project. */
export async function openTerminalTab(profileId?: string): Promise<string | null> {
  const cwd = useUIStore.getState().currentWorkspace ?? undefined
  const pane = await spawnPane(profileId, cwd)
  if ('error' in pane) {
    window.dispatchEvent(new CustomEvent('pi-desktop:terminal-error', { detail: pane.error }))
    return null
  }
  return terminalActions.addTab(pane)
}

/** Ctrl+` anywhere: show / hide the drawer, opening a first shell on the first show. */
export function useTerminalShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return
      e.preventDefault()
      const s = useTerminalStore.getState()
      if (!s.open && s.tabs.length === 0) void openTerminalTab()
      else terminalActions.toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

function ProfileMenu({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (p: ShellProfile) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const profiles = useTerminalStore((s) => s.profiles)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void loadProfiles()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  const r = anchor.getBoundingClientRect()
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[500] min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-[12.5px] text-popover-foreground shadow-lg"
      style={{ left: Math.min(r.left, window.innerWidth - 220), bottom: window.innerHeight - r.top + 6 }}
    >
      {(profiles ?? []).map((p) => (
        <button
          key={p.id}
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          title={p.path}
          onClick={() => {
            onPick(p)
            onClose()
          }}
        >
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {p.piDefault ? <span className="text-[11px] text-foreground-tertiary">{t('common:terminal.default')}</span> : null}
        </button>
      ))}
      {profiles && profiles.length === 0 ? <div className="px-3 py-1.5 text-foreground-tertiary">{t('common:terminal.noShell')}</div> : null}
    </div>
  )
}

function IconButton({ label, onClick, children, buttonRef, active }: { label: string; onClick: () => void; children: React.ReactNode; buttonRef?: React.Ref<HTMLButtonElement>; active?: boolean }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      className={cn('flex h-6 w-6 items-center justify-center rounded-md text-foreground-tertiary hover:bg-muted hover:text-foreground', active && 'bg-muted text-foreground')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Side-by-side panes of one tab, with draggable borders between them. */
function SplitPanes({ tab, active, visible, onClose }: { tab: TerminalTab; active: boolean; visible: boolean; onClose: (ptyId: string) => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const split = tab.panes.length > 1

  const startDrag = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const width = ref.current?.getBoundingClientRect().width || 1
    let lastX = e.clientX
    const onMove = (ev: MouseEvent) => {
      terminalActions.resizeSplit(tab.id, index, (ev.clientX - lastX) / width)
      lastX = ev.clientX
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={ref} className={cn('absolute inset-0 flex', !active && 'invisible')}>
      {tab.panes.map((p, i) => (
        <div key={p.ptyId} className="relative flex min-w-0" style={{ flex: `${tab.sizes[i] ?? 1 / tab.panes.length} 1 0` }}>
          {i > 0 ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('common:terminal.resizePane')}
              className="terminal-split-divider absolute inset-y-0 -left-[3px] z-10 w-[6px] cursor-col-resize"
              onMouseDown={startDrag(i - 1)}
            />
          ) : null}
          <div className={cn('flex min-w-0 flex-1', i > 0 && 'border-l border-border')}>
            <TerminalPane tabId={tab.id} index={i} pane={p} active={active && tab.activePane === i} visible={visible} split={split} onClose={() => onClose(p.ptyId)} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Bottom drawer under the chat and right panel: shell tabs, each with up to two side-by-side
 * panes. Always mounted (terminals keep running and keep their scrollback while it is hidden).
 */
export function TerminalDrawer() {
  const { t } = useTranslation()
  const { open, height, tabs, activeTab } = useTerminalStore()
  const closePane = useClosePane()
  const [menuFor, setMenuFor] = useState<'new' | 'split' | null>(null)
  const newRef = useRef<HTMLButtonElement>(null)
  const splitRef = useRef<HTMLButtonElement>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tab = tabs.find((x) => x.id === activeTab) ?? null
  const activePty = tab?.panes[tab.activePane]?.ptyId

  useEffect(() => {
    setHasSelection(false)
    return activePty ? onTerminalSelection(activePty, setHasSelection) : undefined
  }, [activePty])

  // Pane shortcuts (Ctrl+Shift+W, Enter in an exited pane) arrive from inside xterm.
  useEffect(() => {
    const onClose = (e: Event) => closePane(String((e as CustomEvent).detail))
    const onRestart = async (e: Event) => {
      const old = String((e as CustomEvent).detail)
      const prev = useTerminalStore.getState().tabs.flatMap((x) => x.panes).find((p) => p.ptyId === old)
      if (!prev) return
      const pane = await spawnPane(prev.profile.id, useUIStore.getState().currentWorkspace ?? undefined)
      if ('error' in pane) return setError(pane.error)
      disposeTerminalInstance(old)
      terminalActions.replacePane(old, pane)
    }
    window.addEventListener('pi-desktop:terminal-close-pane', onClose)
    window.addEventListener('pi-desktop:terminal-restart', onRestart)
    return () => {
      window.removeEventListener('pi-desktop:terminal-close-pane', onClose)
      window.removeEventListener('pi-desktop:terminal-restart', onRestart)
    }
  }, [closePane])

  useEffect(() => {
    const onErr = (e: Event) => setError(String((e as CustomEvent).detail ?? ''))
    window.addEventListener('pi-desktop:terminal-error', onErr)
    return () => window.removeEventListener('pi-desktop:terminal-error', onErr)
  }, [])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const zoom = Number(document.documentElement.style.zoom) || 1
    const maxH = Math.max(MIN_TERMINAL_H, window.innerHeight / zoom - 220)
    const onMove = (ev: MouseEvent) => terminalActions.setHeight(Math.min(maxH, startH + (startY - ev.clientY) / zoom))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const split = async (p: ShellProfile) => {
    if (!tab) return
    const pane = await spawnPane(p.id, useUIStore.getState().currentWorkspace ?? undefined)
    if ('error' in pane) setError(pane.error)
    else terminalActions.splitTab(tab.id, pane)
  }

  return (
    <div className="terminal-drawer relative flex h-full min-h-0 flex-col border-t border-border" style={{ background: 'var(--bg-base)' }} aria-hidden={!open}>
      <div className="absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize" onMouseDown={startResize} role="separator" aria-orientation="horizontal" aria-label={t('common:terminal.resize')} />
      <div className="flex h-8 shrink-0 items-center gap-1 px-2" role="tablist" aria-label={t('common:terminal.title')}>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((x) => {
            const exited = x.panes.every((p) => p.exited !== undefined)
            return (
              <div
                key={x.id}
                role="tab"
                aria-selected={x.id === activeTab}
                className={cn(
                  'group/tab flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px]',
                  x.id === activeTab ? 'bg-muted text-foreground' : 'text-foreground-secondary hover:bg-muted/60',
                )}
                onClick={() => terminalActions.focusTab(x.id)}
                onAuxClick={(e) => e.button === 1 && x.panes.map((p) => p.ptyId).forEach(closePane)}
              >
                <TerminalIcon className={cn('h-3 w-3', exited && 'opacity-40')} />
                <span className={cn('max-w-[10rem] truncate', exited && 'text-foreground-tertiary')}>
                  {tabTitle(x)}
                </span>
                <button
                  type="button"
                  aria-label={t('common:terminal.closeTab')}
                  className="flex h-4 w-4 items-center justify-center rounded opacity-0 hover:bg-background group-hover/tab:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    x.panes.map((p) => p.ptyId).forEach(closePane)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          <IconButton label={t('common:terminal.new')} buttonRef={newRef} active={menuFor === 'new'} onClick={() => setMenuFor(menuFor === 'new' ? null : 'new')}>
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        {error ? <span className="max-w-[16rem] truncate text-[11.5px] text-destructive" title={error}>{t('common:terminal.failed', { error })}</span> : null}
        {hasSelection && activePty ? (
          <IconButton label={t('common:terminal.sendSelection')} onClick={() => sendToComposer({ text: `\`\`\`\n${terminalSelection(activePty).trimEnd()}\n\`\`\`` })}>
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        {tab && tab.panes.length < MAX_PANES ? (
          <IconButton label={t('common:terminal.split')} buttonRef={splitRef} active={menuFor === 'split'} onClick={() => setMenuFor(menuFor === 'split' ? null : 'split')}>
            <Columns2 className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        <IconButton label={t('common:terminal.hide')} onClick={() => terminalActions.setOpen(false)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((x) => (
          <SplitPanes key={x.id} tab={x} active={x.id === activeTab} visible={open && x.id === activeTab} onClose={closePane} />
        ))}
        {tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-foreground-tertiary">
            <button type="button" className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground" onClick={() => void openTerminalTab()}>
              {t('common:terminal.empty')}
            </button>
          </div>
        ) : null}
      </div>
      {menuFor === 'new' && newRef.current ? (
        <ProfileMenu anchor={newRef.current} onPick={(p) => { setError(null); void openTerminalTab(p.id) }} onClose={() => setMenuFor(null)} />
      ) : null}
      {menuFor === 'split' && splitRef.current ? <ProfileMenu anchor={splitRef.current} onPick={(p) => void split(p)} onClose={() => setMenuFor(null)} /> : null}
    </div>
  )
}
