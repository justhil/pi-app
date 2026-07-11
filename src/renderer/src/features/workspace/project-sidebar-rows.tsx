import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, Inbox, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
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
  return (
    <div className="sidebar-session-tree ml-3 border-l border-border/40 pl-1.5 pt-0.5">
      {loading ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:loading')}</p>
      ) : projectSessions.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:sidebar.noSessions')}</p>
      ) : (
        projectSessions.map((s) => {
          const running = !!(
            s.sessionFile &&
            Object.entries(sessionRuntimeRunning).some(
              ([runtimeKey, isRunning]) => isRunning && sessionFilesEqual(runtimeKey, s.sessionFile),
            )
          )
          return (
          <div
            key={s.sessionId}
            role="button"
            tabIndex={0}
            onClick={() => {
              guardSessionSwitch(() => {
                if (workspacePath === currentWorkspace) {
                  void switchSessionInPlace(s.sessionId, s.sessionFile)
                } else {
                  void activateWorkspace(workspacePath, {
                    sessionId: s.sessionId,
                    sessionFile: s.sessionFile,
                  })
                }
              })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              guardSessionSwitch(() => {
                if (workspacePath === currentWorkspace) {
                  void switchSessionInPlace(s.sessionId, s.sessionFile)
                } else {
                  void activateWorkspace(workspacePath, {
                    sessionId: s.sessionId,
                    sessionFile: s.sessionFile,
                  })
                }
              })
            }}
            onContextMenu={(e) =>
              onSessionContextMenu(e, {
                sessionId: s.sessionId,
                sessionFile: s.sessionFile,
                title: s.title || s.sessionId.slice(0, 8),
                workspacePath,
              })
            }
            className={cn(
              'nav-row sidebar-session-row mb-0.5 flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 py-1.5',
              currentSessionId === s.sessionId && workspacePath === currentWorkspace
                ? 'nav-row-active'
                : 'text-foreground-secondary hover:text-foreground',
            )}
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