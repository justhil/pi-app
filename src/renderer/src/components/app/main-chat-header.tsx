import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Copy,
  FileDiff,
  GitBranch,
  GitFork,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
} from '@renderer/components/icons'
import { SessionPinGlyph, isSessionPinned, toggleSessionPinned } from '@renderer/lib/pinned-sessions'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import type { TopbarGitDiffStat } from '@renderer/components/app/immersive-chrome'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SIDEBAR_RELOAD_EVENT } from '@renderer/lib/reload-current-session-data'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'

interface MainChatHeaderProps {
  projectName?: string
  sessionTitle?: string
  gitBranch?: string
  gitDiffStat?: TopbarGitDiffStat | null
  isHome?: boolean
  onForkCurrent?: () => void
}

/** Codex-style 48px main conversation header aligned horizontally with Activity Rail, Sidebar & Right Dock. */
export function MainChatHeader({
  projectName,
  sessionTitle,
  gitBranch,
  gitDiffStat,
  isHome = false,
  onForkCurrent,
}: MainChatHeaderProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')

  const rightHidden = useRightPanelHidden()
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const pinnedSessions = useUIStore((s) => s.pinnedSessions)
  const ui = useUIStore((s) => s.uiCustomization)

  if (!ui.shellChatHeaderVisible) return null

  const showTitle = ui.shellChatHeaderShowTitle
  const showBranch = ui.shellChatHeaderShowBranch
  const showDiff = ui.shellChatHeaderShowDiff

  const hasActiveSession = Boolean(currentSessionId && historySessionFile)
  const isPinned = hasActiveSession && isSessionPinned(pinnedSessions, historySessionFile)
  const displayTitle = sessionTitle || projectName || t('common:home.newChat')

  const hasDiffChanges = Boolean(
    showDiff && gitDiffStat && (gitDiffStat.files > 0 || gitDiffStat.additions > 0 || gitDiffStat.deletions > 0),
  )

  const submitRename = async () => {
    const next = renameDraft.trim()
    setRenaming(false)
    if (!next || !historySessionFile || next === sessionTitle) return
    try {
      await ipcClient.invoke('session.rename', {
        sessionFile: historySessionFile,
        title: next,
        workspaceId: currentWorkspace || undefined,
      })
      window.dispatchEvent(new CustomEvent(SIDEBAR_RELOAD_EVENT))
      toast.success(t('common:sidebar.renamed'))
    } catch {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const handleDeleteCurrent = async () => {
    setMenuOpen(false)
    if (!historySessionFile) return
    const confirmed = window.confirm(
      t('common:sidebar.deleteSessionConfirm', { name: displayTitle }),
    )
    if (!confirmed) return
    try {
      await ipcClient.invoke('session.delete', {
        sessionFile: historySessionFile,
        workspaceId: currentWorkspace || undefined,
      })
      enterBlankSession('pending-project')
      window.dispatchEvent(new CustomEvent(SIDEBAR_RELOAD_EVENT))
      toast.success(t('common:sidebar.deleted'))
    } catch {
      toast.error(t('common:sidebar.deleteFailed'))
    }
  }

  const headerIconBtn = (active = false) =>
    cn(
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
      active
        ? 'bg-foreground/[0.08] text-foreground'
        : 'text-foreground-secondary/80 hover:bg-foreground/[0.05] hover:text-foreground',
    )

  return (
    <header
      data-pi-slot="main-chat-header"
      className="flex h-12 shrink-0 items-center justify-between gap-3 bg-[var(--chat-bg)] px-6 select-none"
    >
      {/* Left: active session title + subtle branch context (quiet on empty home view) */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isHome || !showTitle ? null : renaming ? (
          <input
            type="text"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => void submitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="h-7 w-full max-w-[320px] rounded-md border border-ring/50 bg-background px-2 text-[14px] font-medium text-foreground outline-none"
          />
        ) : (
          <h1
            data-pi-slot="chat-header-title"
            className="min-w-0 truncate text-[14px] font-medium tracking-[-0.01em] text-foreground"
            title={displayTitle}
          >
            {displayTitle}
          </h1>
        )}

        {!isHome && showBranch && gitBranch ? (
          <span
            data-pi-slot="chat-header-branch"
            className="hidden items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[12px] text-foreground-secondary/50 md:inline-flex"
            title={gitBranch}
          >
            <GitBranch className="h-3 w-3 shrink-0 opacity-65" />
            <span className="max-w-[140px] truncate">{gitBranch}</span>
          </span>
        ) : null}
      </div>

      {/* Right: Codex-style quiet action icons (... menu, diff stat, right panel toggle) */}
      <div className="flex shrink-0 items-center gap-1">
        {hasActiveSession ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title={t('common:topbar.sessionActions')}
              aria-label={t('common:topbar.sessionActions')}
              className={headerIconBtn(menuOpen)}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.65} />
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div
                  role="menu"
                  data-browser-overlay=""
                  className="absolute right-0 top-8 z-50 w-[196px] rounded-xl border border-border/65 bg-popover p-1.5 text-[12.5px] text-popover-foreground shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      setRenameDraft(sessionTitle || '')
                      setRenaming(true)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <Pencil className="h-3.5 w-3.5 opacity-75" />
                    <span>{t('common:sidebar.rename')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      if (historySessionFile) {
                        toggleSessionPinned({
                          sessionFile: historySessionFile,
                          sessionId: currentSessionId || '',
                          workspacePath: currentWorkspace || '',
                          title: displayTitle,
                          kind: 'project',
                        })
                      }
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <SessionPinGlyph className="h-3.5 w-3.5 opacity-75" filled={isPinned} />
                    <span>{isPinned ? t('common:sidebar.unpinSession') : t('common:sidebar.pinSession')}</span>
                  </button>
                  {onForkCurrent ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onForkCurrent()
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                    >
                      <GitFork className="h-3.5 w-3.5 opacity-75" />
                      <span>{t('common:sidebar.fork')}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      if (historySessionFile) {
                        void navigator.clipboard.writeText(historySessionFile)
                        toast.success(t('common:sidebar.copySessionPath'))
                      }
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                  >
                    <Copy className="h-3.5 w-3.5 opacity-75" />
                    <span>{t('common:sidebar.copySessionPath')}</span>
                  </button>
                  <div className="my-1 h-px bg-border/50" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleDeleteCurrent()}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('common:sidebar.delete')}</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {hasDiffChanges && gitDiffStat ? (
          <button
            type="button"
            data-pi-slot="header-diff-toggle"
            title={t('common:panel.reviewDesc')}
            onClick={() => usePanelIntentStore.getState().toggleRightPanelTab('review', !rightHidden)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-medium tabular-nums text-foreground-secondary transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <FileDiff className="h-3.5 w-3.5 shrink-0 opacity-75" />
            {gitDiffStat.additions > 0 || gitDiffStat.deletions > 0 ? (
              <span className="flex items-center gap-1">
                {gitDiffStat.additions > 0 ? (
                  <span style={{ color: 'var(--diff-added)' }}>+{gitDiffStat.additions}</span>
                ) : null}
                {gitDiffStat.deletions > 0 ? (
                  <span style={{ color: 'var(--diff-removed)' }}>-{gitDiffStat.deletions}</span>
                ) : null}
              </span>
            ) : (
              <span>{gitDiffStat.files}</span>
            )}
          </button>
        ) : null}

        {rightHidden ? (
          <button
            type="button"
            data-right-panel-toggle=""
            onClick={() => toggleRightPanel()}
            title={t('common:topbar.expandRightPanel')}
            aria-label={t('common:topbar.expandRightPanel')}
            className={headerIconBtn(false)}
          >
            <PanelRight className="h-4 w-4" strokeWidth={1.65} />
          </button>
        ) : null}
      </div>
    </header>
  )
}
