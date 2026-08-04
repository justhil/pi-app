import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, GitBranch, Inbox, Plus } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { collectActiveSubagentSessionChildren } from '@renderer/lib/subagent-session-activity'
import { useToolCardCatalogReady } from '@renderer/features/timeline/tool-card-registry'
import { SessionRunningPixelGrid } from './session-running-pixel-grid'
import type { SandboxEntry, SessionItem } from './project-sidebar-types'

export function ProjectSessionTree({
  workspacePath,
  projectSessions,
  loading,
  currentWorkspace,
  currentSessionId,
  onSessionContextMenu,
}: {
  workspacePath: string
  projectSessions: SessionItem[]
  loading: boolean
  currentWorkspace: string | null
  currentSessionId: string | null
  onSessionContextMenu: (
    e: React.MouseEvent,
    payload: { sessionId: string; sessionFile?: string; title: string; workspacePath: string },
  ) => void
}) {
  const { t } = useTranslation()
  const sessionRuntimeRunning = useUIStore((st) => st.sessionRuntimeRunning)
  const historySessionFile = useUIStore((st) => st.historySessionFile)
  const timelineItems = useUIStore((st) => st.timelineItems)
  const subagentSessionGroup = useUIStore((st) => st.subagentSessionGroup)
  const catalogReady = useToolCardCatalogReady()
  const [expandedSessionFiles, setExpandedSessionFiles] = useState<Set<string>>(() => new Set())
  const liveChildren = useMemo(
    () => collectActiveSubagentSessionChildren(timelineItems),
    [catalogReady, timelineItems],
  )

  const activeParentSessionFiles = useMemo(() => {
    const activeFiles = new Set<string>()
    for (const session of projectSessions) {
      if (!session.sessionFile) continue
      const currentParent =
        currentWorkspace === workspacePath
        && sessionFilesEqual(session.sessionFile, historySessionFile)
      const retainedChildren =
        subagentSessionGroup?.workspacePath === workspacePath
        && sessionFilesEqual(subagentSessionGroup.parentSessionFile, session.sessionFile)
          ? subagentSessionGroup.children
          : []
      const children = currentParent ? liveChildren : retainedChildren
      if (children.length > 0) activeFiles.add(session.sessionFile)
    }
    return activeFiles
  }, [currentWorkspace, historySessionFile, liveChildren, projectSessions, subagentSessionGroup, workspacePath])

  useEffect(() => {
    const group = subagentSessionGroup
    if (!group || group.workspacePath !== workspacePath) return
    const childSelected = group.children.some(
      (child) => child.sessionFile && sessionFilesEqual(child.sessionFile, historySessionFile),
    )
    if (!childSelected) return
    setExpandedSessionFiles((previous) => {
      if (previous.has(group.parentSessionFile)) return previous
      return new Set(previous).add(group.parentSessionFile)
    })
  }, [historySessionFile, subagentSessionGroup, workspacePath])

  useEffect(() => {
    setExpandedSessionFiles((previous) => {
      const next = new Set(
        [...previous].filter((sessionFile) => activeParentSessionFiles.has(sessionFile)),
      )
      return next.size === previous.size ? previous : next
    })
  }, [activeParentSessionFiles])

  const openParentSession = (session: SessionItem) => {
    guardSessionSwitch(() => {
      if (workspacePath === currentWorkspace) {
        void switchSessionInPlace(session.sessionId, session.sessionFile)
      } else {
        void activateWorkspace(workspacePath, {
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
        })
      }
    })
  }

  return (
    <div className="sidebar-session-tree ml-3 border-l border-border/40 pl-1.5 pt-0.5">
      {loading ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:loading')}</p>
      ) : projectSessions.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:sidebar.noSessions')}</p>
      ) : (
        projectSessions.map((s) => {
          const sessionFile = s.sessionFile
          const currentParent = !!sessionFile
            && currentWorkspace === workspacePath
            && sessionFilesEqual(sessionFile, historySessionFile)
          const retainedChildren =
            sessionFile
            && subagentSessionGroup?.workspacePath === workspacePath
            && sessionFilesEqual(subagentSessionGroup.parentSessionFile, sessionFile)
              ? subagentSessionGroup.children
              : []
          const children = currentParent ? liveChildren : retainedChildren
          const expanded = !!sessionFile && expandedSessionFiles.has(sessionFile)
          const running = !!(
            sessionFile &&
            Object.entries(sessionRuntimeRunning).some(
              ([runtimeKey, isRunning]) => isRunning && sessionFilesEqual(runtimeKey, sessionFile),
            )
          )
          const parentActive =
            currentSessionId === s.sessionId
            && workspacePath === currentWorkspace
            && sessionFilesEqual(historySessionFile, sessionFile)
          return (
            <div key={s.sessionId} className="mb-0.5">
              <div
                onContextMenu={(event) =>
                  onSessionContextMenu(event, {
                    sessionId: s.sessionId,
                    sessionFile,
                    title: s.title || s.sessionId.slice(0, 8),
                    workspacePath,
                  })
                }
                className={cn(
                  'nav-row sidebar-session-row flex min-h-[38px] items-center gap-0.5 rounded-lg px-1 py-0.5',
                  parentActive
                    ? 'nav-row-active'
                    : 'text-foreground-secondary hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => openParentSession(s)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] leading-[18px] text-foreground">
                      {s.title || s.sessionId.slice(0, 8)}
                    </div>
                    <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
                      {new Date(s.updatedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  {running ? (
                    <SessionRunningPixelGrid
                      className="ml-0.5 opacity-80"
                      title={t('common:status.running', { defaultValue: 'Running' })}
                    />
                  ) : null}
                </button>
                {children.length > 0 && sessionFile && (
                  <button
                    type="button"
                    aria-label={t('common:sidebar.toggleSubagents', {
                      title: s.title || s.sessionId.slice(0, 8),
                    })}
                    aria-expanded={expanded}
                    onClick={() => {
                      setExpandedSessionFiles((previous) => {
                        const next = new Set(previous)
                        if (next.has(sessionFile)) next.delete(sessionFile)
                        else next.add(sessionFile)
                        return next
                      })
                    }}
                    className="chrome-icon-btn flex h-7 w-6 shrink-0 items-center justify-center rounded-md"
                  >
                    <ChevronRight
                      className="chevron-expand h-3 w-3 text-foreground-secondary/75"
                      data-open={expanded ? 'true' : 'false'}
                    />
                  </button>
                )}
              </div>
              {children.length > 0 && (
                <SidebarAnimatedCollapse open={expanded}>
                  <div className="ml-5 border-l border-border/35 pb-0.5 pl-1.5 pt-0.5">
                    {children.map((child) => {
                      const childActive = !!child.sessionFile
                        && workspacePath === currentWorkspace
                        && sessionFilesEqual(child.sessionFile, historySessionFile)
                      const canOpen = !!child.sessionFile
                      return (
                        <button
                          key={child.key}
                          type="button"
                          disabled={!canOpen}
                          aria-label={canOpen
                            ? t('common:sidebar.openSubagentSession', { agent: child.agent })
                            : t('common:sidebar.subagentSessionUnavailable', { agent: child.agent })}
                          onClick={() => {
                            if (child.sessionFile) void openSubagentSessionPreview(child.sessionFile)
                          }}
                          className={cn(
                            'nav-row sidebar-subagent-row mb-0.5 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
                            childActive
                              ? 'nav-row-active'
                              : 'text-foreground-secondary hover:text-foreground',
                            !canOpen && 'cursor-default opacity-60',
                          )}
                        >
                          <GitBranch className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/70" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[11px] leading-[16px] text-foreground">
                              {child.agent}
                            </div>
                            <div className="truncate text-[10px] leading-[14px] text-foreground-secondary/75">
                              {child.task || t(`timeline:tree.state.${child.state}`)}
                            </div>
                          </div>
                          <span className="shrink-0 text-[9px] font-medium text-foreground-secondary/65">
                            {t(`timeline:tree.state.${child.state}`)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </SidebarAnimatedCollapse>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

export function ProjectDiskRow({
  path,
  name,
  active,
  open,
  onToggleOpen,
  onNewSession,
  onProjectContextMenu,
  sessionTree,
}: {
  path: string
  name: string
  active: boolean
  open: boolean
  onToggleOpen: () => void
  onNewSession: () => void
  onProjectContextMenu: (e: React.MouseEvent) => void
  sessionTree: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div key={path} className="sidebar-project-row mb-0.5" onContextMenu={onProjectContextMenu}>
      <div
        className={cn(
          'nav-row flex min-h-[36px] items-center gap-0.5 rounded-lg px-0.5',
          (active || open) && 'bg-[var(--bg-hover)]/80',
        )}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          className="sidebar-project-hit flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left"
          title={path}
          aria-expanded={open}
        >
          <ChevronRight
            className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/80"
            data-open={open ? 'true' : 'false'}
          />
          <Folder
            className={cn(
              'folder-icon h-4 w-4 shrink-0 transition-colors duration-200',
              active ? 'text-brand' : 'text-foreground-secondary/70',
            )}
          />
          <span
            className={cn(
              'truncate text-[14px] leading-[20px]',
              active ? 'font-medium text-foreground' : 'text-foreground-secondary',
            )}
          >
            {name}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNewSession()
          }}
          title={t('common:newSession')}
          className="chrome-icon-btn ml-0.5 cursor-pointer rounded p-1"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <SidebarAnimatedCollapse open={open}>{sessionTree}</SidebarAnimatedCollapse>
    </div>
  )
}

export function SandboxDialogRow({
  box,
  active,
  onOpen,
  onContextMenu,
}: {
  box: SandboxEntry
  active: boolean
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const displayLabel =
    box.label?.trim() || t('common:sidebar.tempChat')
  return (
    <div
      key={box.path}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onContextMenu={onContextMenu}
      className={cn(
        'nav-row sidebar-session-row mb-0.5 flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 py-2',
        active ? 'nav-row-active' : 'text-foreground-secondary hover:text-foreground',
      )}
    >
      <Inbox className={cn('h-4 w-4 shrink-0', active ? 'text-brand' : 'opacity-70')} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] leading-[20px] text-foreground">{displayLabel}</div>
        <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
          {new Date(box.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}
