import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, GitBranch, Inbox, Plus } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { buildSessionTree, filterSessionTree, type SessionNode, type SessionChildGroup } from './project-session-tree'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { collectActiveSubagentSessionChildren } from '@renderer/lib/subagent-session-activity'
import { useToolCardCatalogReady } from '@renderer/features/timeline/tool-card-registry'
import { SessionAttentionDot } from './session-attention-dot'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import type { SandboxEntry, SessionItem } from './project-sidebar-types'

export function ProjectSessionTree({
  workspacePath,
  projectSessions,
  searchQuery = '',
  loading,
  error,
  onRetry,
  currentWorkspace,
  currentSessionId,
  onSessionContextMenu,
}: {
  workspacePath: string
  projectSessions: SessionItem[]
  searchQuery?: string
  loading: boolean
  error?: string
  onRetry?: () => void
  currentWorkspace: string | null
  currentSessionId: string | null
  onSessionContextMenu: (
    e: React.MouseEvent,
    payload: { sessionId: string; sessionFile?: string; title: string; workspacePath: string },
  ) => void
}) {
  const { t } = useTranslation()
  const sessionAttention = useUIStore((st) => st.sessionAttention)
  const historySessionFile = useUIStore((st) => st.historySessionFile)
  const timelineItems = useUIStore((st) => st.timelineItems)
  const subagentSessionGroup = useUIStore((st) => st.subagentSessionGroup)
  const catalogReady = useToolCardCatalogReady()
  const [expandedSessionFiles, setExpandedSessionFiles] = useState<Set<string>>(() => new Set())
  const liveChildren = useMemo(
    () => collectActiveSubagentSessionChildren(timelineItems),
    [catalogReady, timelineItems],
  )

  const tree = useMemo(() => {
    const groups: SessionChildGroup[] = []
    if (workspacePathsEqual(currentWorkspace, workspacePath) && historySessionFile) {
      groups.push({ parentSessionFile: historySessionFile, children: liveChildren })
    }
    if (subagentSessionGroup && workspacePathsEqual(subagentSessionGroup.workspacePath, workspacePath)
      && workspacePathKey(subagentSessionGroup.parentSessionFile) !== workspacePathKey(historySessionFile)) {
      groups.push(subagentSessionGroup)
    }
    return buildSessionTree(projectSessions, groups)
  }, [currentWorkspace, historySessionFile, liveChildren, projectSessions, subagentSessionGroup, workspacePath])
  const visibleRoots = useMemo(() => filterSessionTree(tree.roots, searchQuery), [tree, searchQuery])
  const revealedSelection = useRef('')
  const selectedKey = workspacePathsEqual(currentWorkspace, workspacePath) ? workspacePathKey(historySessionFile) : ''

  useEffect(() => {
    if (revealedSelection.current === selectedKey) return
    revealedSelection.current = ''
    if (!selectedKey) return
    const selected = tree.byKey.get(selectedKey)
    let parentKey = selected?.parentKey
    if (!selected) {
      parentKey = [...tree.byKey.values()].find((node) => node.liveChildren.some(
        (child) => workspacePathKey(child.sessionFile) === selectedKey,
      ))?.key
      if (!parentKey) return
    }
    revealedSelection.current = selectedKey
    const ancestors: string[] = []
    while (parentKey) {
      ancestors.push(parentKey)
      parentKey = tree.byKey.get(parentKey)?.parentKey
    }
    if (ancestors.length) setExpandedSessionFiles((previous) => new Set([...previous, ...ancestors]))
  }, [selectedKey, tree])

  useEffect(() => {
    setExpandedSessionFiles((previous) => {
      const next = new Set([...previous].filter((key) => {
        const node = tree.byKey.get(key)
        return node && (node.children.length > 0 || node.liveChildren.length > 0)
      }))
      return next.size === previous.size ? previous : next
    })
  }, [tree])

  const openParentSession = (session: SessionItem) => {
    guardSessionSwitch(() => {
      if (workspacePathsEqual(workspacePath, currentWorkspace)) {
        void switchSessionInPlace(session.sessionId, session.sessionFile)
      } else {
        void activateWorkspace(workspacePath, {
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
        })
      }
    })
  }

  const renderSession = (node: SessionNode): ReactNode => {
    const s = node.session
    const sessionFile = s.sessionFile
    const { children, liveChildren: transientChildren } = node
    const childCount = children.length + transientChildren.length
    const childrenId = `session-children-${encodeURIComponent(node.key)}`
    const expanded = !!searchQuery.trim() || expandedSessionFiles.has(node.key)
    const ownAttention = selectSessionAttention(sessionFile, sessionAttention)
    const attention = node.liveChild?.state === 'running' && ownAttention === 'idle' ? 'working' : ownAttention
    const parentActive = currentSessionId === s.sessionId
      && workspacePathsEqual(workspacePath, currentWorkspace)
      && workspacePathKey(historySessionFile) === node.key
    return (
      <div key={node.key} className="mb-0.5" data-session-file={sessionFile}>
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
            onClick={() => {
              if (node.liveChild && sessionFile) guardSessionSwitch(() => { void openSubagentSessionPreview(sessionFile) })
              else openParentSession(s)
            }}
            aria-current={parentActive ? 'page' : undefined}
            className="sidebar-session-hit flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          >
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'truncate text-[13px] leading-[18px] text-foreground',
                  attention === 'done' && 'font-semibold',
                )}
              >
                {s.title || s.sessionId.slice(0, 8)}
              </div>
              {s.firstMessage && s.firstMessage !== s.title && !s.firstMessage.startsWith(s.title) ? (
                <div className="mt-0.5 truncate text-[12px] leading-[18px] text-foreground-secondary">
                  {s.firstMessage}
                </div>
              ) : (
                <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
                  {new Date(s.updatedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
            <SessionAttentionDot
              attention={attention}
              className="ml-0.5"
              title={
                attention === 'needs-you'
                  ? t('common:attention.needsYou')
                  : attention === 'done'
                    ? t('common:attention.done')
                    : attention === 'working'
                      ? t('common:app.status.running')
                      : undefined
              }
            />
          </button>
          {childCount > 0 && sessionFile && (
            <button
              type="button"
              aria-label={t('common:sidebar.toggleSubagents', {
                title: s.title || s.sessionId.slice(0, 8),
              })}
              aria-expanded={expanded}
              aria-controls={childrenId}
              title={t('common:sidebar.childSessionCount', { count: childCount })}
              onClick={() => {
                setExpandedSessionFiles((previous) => {
                  const next = new Set(previous)
                  if (next.has(node.key)) next.delete(node.key)
                  else next.add(node.key)
                  return next
                })
              }}
              className="chrome-icon-btn flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1.5"
            >
              <span className="text-[11px] tabular-nums text-foreground-secondary">{childCount}</span>
              <ChevronRight
                className="chevron-expand h-3 w-3 text-foreground-secondary/75"
                data-open={expanded ? 'true' : 'false'}
              />
            </button>
          )}
        </div>
        {expanded && childCount > 0 && (
          <div id={childrenId} className="ml-3 min-w-0 border-l border-border/35 pb-0.5 pl-1.5 pt-0.5">
            {children.map(renderSession)}
            {transientChildren.map((child) => {
              const childActive = !!child.sessionFile
                        && workspacePathsEqual(workspacePath, currentWorkspace)
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
                    const file = child.sessionFile
                    if (file) guardSessionSwitch(() => { void openSubagentSessionPreview(file) })
                  }}
                  className={cn(
                    'nav-row sidebar-subagent-row mb-0.5 flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
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
        )}
      </div>
    )
  }

  return (
    <div className="sidebar-session-tree ml-3 border-l border-border/40 pl-1.5 pt-0.5">
      {error && <div role="status" className="px-2 py-2 text-xs text-foreground-secondary" title={error}>
        <p>{t('common:sidebar.sessionReadFailed')}</p>
        <button type="button" className="workbench-button mt-1" disabled={loading} onClick={onRetry}>{t('common:retry')}</button>
      </div>}
      {loading ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:loading')}</p>
      ) : visibleRoots.length === 0 ? (
        !error && <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:sidebar.noSessions')}</p>
      ) : visibleRoots.map(renderSession)}
    </div>
  )
}

export function ProjectDiskRow({
  path,
  name,
  branch,
  worktree = false,
  active,
  open,
  onToggleOpen,
  onOpenProject,
  onNewSession,
  onProjectContextMenu,
  sessionTree,
}: {
  path: string
  name: string
  branch?: string
  worktree?: boolean
  active: boolean
  open: boolean
  onToggleOpen: () => void
  onOpenProject?: () => void
  onNewSession: () => void
  onProjectContextMenu: (e: React.MouseEvent) => void
  sessionTree: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div key={path} className="sidebar-project-row mb-0.5" data-workspace={path} onContextMenu={onProjectContextMenu}>
      <div
        className={cn(
          'nav-row flex min-h-[36px] items-center gap-0.5 rounded-lg px-0.5',
          active && 'nav-row-active',
        )}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          className="workbench-icon shrink-0"
          aria-label={t('common:sidebar.toggleProject', { name })}
          aria-expanded={open}
        >
          <ChevronRight
            className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/80"
            data-open={open ? 'true' : 'false'}
          />
        </button>
        <button
          type="button"
          onClick={() => guardSessionSwitch(onOpenProject || onToggleOpen)}
          className="sidebar-project-hit flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left"
          title={path}
          aria-current={active ? 'location' : undefined}
        >
          {worktree ? <GitBranch className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" /> : <Folder
            className={cn(
              'folder-icon h-4 w-4 shrink-0',
              active ? 'text-brand' : 'text-foreground-secondary/70',
            )}
          />}
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-[13px] leading-5', active ? 'font-semibold text-foreground' : 'font-medium text-foreground-secondary')}>{name}</span>
            {branch && branch !== name ? <span className="mt-0.5 block truncate text-[11px] text-foreground-secondary" title={branch}>{branch.replace(/^refs\/heads\//, '')}</span> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNewSession()
          }}
          aria-label={t('common:newSession')}
          className="workbench-icon ml-0.5 shrink-0"
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
  const attention = useUIStore((state) => selectSessionAttention(box.sessionFile, state.sessionAttention))
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
        <div
          className={cn(
            'truncate text-[14px] leading-[20px] text-foreground',
            attention === 'done' && 'font-semibold',
          )}
        >
          {displayLabel}
        </div>
        <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
          {new Date(box.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
      <SessionAttentionDot
        attention={attention}
        className="ml-0.5"
        title={
          attention === 'needs-you'
            ? t('common:attention.needsYou')
            : attention === 'done'
              ? t('common:attention.done')
              : attention === 'working'
                ? t('common:app.status.running')
                : undefined
        }
      />
    </div>
  )
}
