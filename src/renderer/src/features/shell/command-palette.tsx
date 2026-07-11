import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  FileSearch,
  FolderTree,
  GitBranch,
  Keyboard,
  ListTree,
  MessageSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

export type CommandPaletteAction = {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  keywords?: string
  run: () => void
}

function openRightPanel(panelId: string) {
  const store = useUIStore.getState()
  store.setActivePanel(panelId)
  if (store.rightPanelCollapsed) store.toggleRightPanel()
}

function focusComposer() {
  window.dispatchEvent(new CustomEvent('pi-desktop:focus-composer'))
  const el =
    document.querySelector<HTMLElement>('[data-composer-input]') ||
    document.querySelector<HTMLElement>('[contenteditable="true"]')
  el?.focus()
}

/**
 * Navigation-only command palette (Ctrl/Cmd+K).
 * Opens settings, right panels, composer focus, session tree — no agent capabilities.
 */
export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onOpenSessionTree,
  onOpenShortcuts,
}: {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenSessionTree?: () => void
  onOpenShortcuts?: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const actions = useMemo<CommandPaletteAction[]>(() => {
    const list: CommandPaletteAction[] = [
      {
        id: 'settings',
        label: t('common:commandPalette.settings'),
        hint: t('common:sidebar.settings'),
        icon: Settings,
        keywords: 'settings preferences 设置',
        run: () => {
          onOpenSettings()
          onClose()
        },
      },
      {
        id: 'composer',
        label: t('common:commandPalette.focusComposer'),
        icon: MessageSquare,
        keywords: 'composer input message 输入',
        run: () => {
          focusComposer()
          onClose()
        },
      },
      {
        id: 'panel-files',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.files') }),
        icon: FolderTree,
        keywords: 'files panel 文件',
        run: () => {
          openRightPanel('files')
          onClose()
        },
      },
      {
        id: 'panel-run',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.run') }),
        icon: Activity,
        keywords: 'run status 运行',
        run: () => {
          openRightPanel('run')
          onClose()
        },
      },
      {
        id: 'panel-review',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.review') }),
        icon: GitBranch,
        keywords: 'review diff git',
        run: () => {
          openRightPanel('review')
          onClose()
        },
      },
      {
        id: 'panel-tree',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.tree') }),
        icon: ListTree,
        keywords: 'tree rewind session',
        run: () => {
          openRightPanel('tree')
          onClose()
        },
      },
      {
        id: 'panel-context',
        label: t('common:commandPalette.openPanel', { panel: t('common:panel.context') }),
        icon: FileSearch,
        keywords: 'context',
        run: () => {
          openRightPanel('context')
          onClose()
        },
      },
    ]
    if (onOpenSessionTree) {
      list.push({
        id: 'session-tree',
        label: t('common:commandPalette.sessionTree'),
        hint: 'Esc Esc',
        icon: ListTree,
        keywords: 'tree overlay rewind fork',
        run: () => {
          onOpenSessionTree()
          onClose()
        },
      })
    }
    if (onOpenShortcuts) {
      list.push({
        id: 'shortcuts',
        label: t('common:commandPalette.shortcuts'),
        hint: 'Ctrl+/',
        icon: Keyboard,
        keywords: 'shortcuts keyboard help 快捷键',
        run: () => {
          onOpenShortcuts()
          onClose()
        },
      })
    }
    return list
  }, [t, onOpenSettings, onOpenSessionTree, onOpenShortcuts, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((action) => {
      const hay = `${action.label} ${action.hint || ''} ${action.keywords || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const runSelected = useCallback(() => {
    const action = filtered[index]
    if (action) action.run()
  }, [filtered, index])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        runSelected()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered.length, onClose, runSelected])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/35 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('common:commandPalette.title')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated,var(--bg-1))] shadow-2xl">
        <div className="border-b border-border/50 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common:commandPalette.placeholder')}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-secondary/50"
            aria-autocomplete="list"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-foreground-secondary/70">
              {t('common:commandPalette.empty')}
            </li>
          ) : (
            filtered.map((action, actionIndex) => {
              const Icon = action.icon
              const active = actionIndex === index
              return (
                <li key={action.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]',
                      active
                        ? 'bg-[var(--bg-hover)] text-foreground'
                        : 'text-foreground-secondary hover:bg-[var(--bg-hover)]/70 hover:text-foreground',
                    )}
                    onMouseEnter={() => setIndex(actionIndex)}
                    onClick={() => action.run()}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.hint ? (
                      <span className="shrink-0 text-[10px] text-foreground-secondary/50">
                        {action.hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="border-t border-border/40 px-3 py-1.5 text-[10px] text-foreground-secondary/45">
          {t('common:commandPalette.footer')}
        </div>
      </div>
    </div>
  )
}

export function ShortcutsHelpSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const rows: { keys: string; label: string }[] = [
    { keys: 'Ctrl/⌘ K', label: t('common:shortcuts.commandPalette') },
    { keys: 'Ctrl/⌘ /', label: t('common:shortcuts.thisSheet') },
    { keys: 'Esc Esc', label: t('common:shortcuts.sessionTree') },
    { keys: 'Alt ↑', label: t('common:shortcuts.restoreQueue') },
    { keys: 'Esc', label: t('common:shortcuts.stopOrDismiss') },
  ]

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center bg-black/35 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('common:shortcuts.title')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-[var(--surface-elevated,var(--bg-1))] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-foreground">{t('common:shortcuts.title')}</h2>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
            onClick={onClose}
          >
            {t('common:commandPalette.close')}
          </button>
        </div>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.keys}
              className="flex items-center justify-between gap-3 rounded-md border border-border/30 px-2.5 py-1.5"
            >
              <span className="text-[12px] text-foreground-secondary">{row.label}</span>
              <kbd className="rounded border border-border/50 bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-foreground-secondary/55">{t('common:shortcuts.navOnly')}</p>
      </div>
    </div>
  )
}
