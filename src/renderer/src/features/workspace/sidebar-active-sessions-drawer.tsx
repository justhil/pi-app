import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, X } from '@renderer/components/icons'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { useVisibleInterval } from '@renderer/hooks/use-visible-interval'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import { loadWorkspaceSessionList } from '@renderer/lib/refresh-workspace-session-lists'
import {
  buildActiveDrawerEntries,
  countAttention,
  type ActiveDrawerEntry,
} from '@renderer/lib/session-attention'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { resolveProjectDisplayName, workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import { diskProjectName } from './project-sidebar-types'
import { SessionAttentionDot } from './session-attention-dot'

type PreparedSessionMeta = {
  sessionId: string
  sessionFile: string
  workspaceId: string
}

function formatRelativeAge(lastActiveAt: number, now: number, justNowLabel: string): string {
  if (!lastActiveAt || lastActiveAt <= 0) return ''
  const diffMinutes = Math.max(0, Math.floor((now - lastActiveAt) / 60_000))
  if (diffMinutes < 1) return justNowLabel
  return `${diffMinutes}m`
}

export function SidebarActiveSessionsDrawer() {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const enabled = useUIStore((s) => s.sidebarActiveSessionsDrawer)
  const open = useUIStore((s) => s.sidebarActiveSessionsOpen)
  const setOpen = useUIStore((s) => s.setSidebarActiveSessionsOpen)
  const attention = useUIStore((s) => s.sessionAttention)
  const recentActiveAt = useUIStore((s) => s.sessionLastActiveAt)
  const dismissRecentSession = useUIStore((s) => s.dismissRecentSession)
  const sessions = useUIStore((s) => s.sessions)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const projectDisplayNames = useUIStore((s) => s.projectDisplayNames)

  const [now, setNow] = useState(() => Date.now())
  const [sessionsByWorkspace, setSessionsByWorkspace] = useState<Record<string, SessionItem[]>>({})
  const [preparedByFile, setPreparedByFile] = useState<Record<string, PreparedSessionMeta>>({})
  const [sessionDisplayNames, setSessionDisplayNames] = useState<Record<string, string>>({})

  useVisibleInterval(() => setNow(Date.now()), 30_000)

  useEffect(() => {
    ipcClient
      .invoke('settings.get', { key: 'sessionDisplayNames' })
      .then((res) => {
        if (res?.settings?.sessionDisplayNames) {
          setSessionDisplayNames(res.settings.sessionDisplayNames)
        }
      })
      .catch(() => {})
  }, [sessions])

  const entries = useMemo(
    () => buildActiveDrawerEntries({ attention, recentActiveAt, now }),
    [attention, recentActiveAt, now],
  )

  const counts = useMemo(() => countAttention(attention), [attention])

  // Resolve metadata (title + workspace) for sessions outside the currently loaded project list.
  useEffect(() => {
    if (collapsed || !enabled || entries.length === 0) return
    let cancelled = false
    const requestedWorkspaces = new Set<string>()

    const ensureWorkspaceLoaded = (workspace: string | null | undefined) => {
      if (cancelled || !workspace || workspacePathsEqual(workspace, currentWorkspace)) return
      const key = workspacePathKey(workspace)
      if (!key || requestedWorkspaces.has(key) || sessionsByWorkspace[key]) return
      requestedWorkspaces.add(key)
      void loadWorkspaceSessionList(workspace).then((list) => {
        if (!cancelled && list) {
          setSessionsByWorkspace((prev) => ({ ...prev, [key]: list }))
        }
      })
    }

    for (const entry of entries) {
      const inCurrent = sessions.some((s) => sessionFilesEqual(s.sessionFile, entry.sessionFile))
      if (inCurrent) continue
      const inCached = Object.values(sessionsByWorkspace)
        .flat()
        .some((s) => sessionFilesEqual(s.sessionFile, entry.sessionFile))
      if (inCached) continue
      const key = normalizeSessionFileKey(entry.sessionFile) || entry.sessionFile
      const known = preparedByFile[key]
      if (known) {
        ensureWorkspaceLoaded(known.workspaceId)
        continue
      }
      void ipcClient
        .invoke('session.prepare', { sessionFile: entry.sessionFile, bind: false })
        .then((prepared) => {
          if (cancelled || !prepared?.sessionId || !prepared?.workspaceId) return
          setPreparedByFile((prev) => ({
            ...prev,
            [key]: {
              sessionId: prepared.sessionId,
              sessionFile: prepared.sessionFile || entry.sessionFile,
              workspaceId: prepared.workspaceId,
            },
          }))
          ensureWorkspaceLoaded(prepared.workspaceId)
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [collapsed, enabled, entries, sessions, currentWorkspace, sessionsByWorkspace, preparedByFile])

  const findSession = useCallback(
    (file: string): SessionItem | undefined =>
      sessions.find((s) => sessionFilesEqual(s.sessionFile, file)) ??
      Object.values(sessionsByWorkspace)
        .flat()
        .find((s) => sessionFilesEqual(s.sessionFile, file)),
    [sessions, sessionsByWorkspace],
  )

  const handleSelectSession = useCallback(
    async (entry: ActiveDrawerEntry) => {
      const file = entry.sessionFile
      if (sessionFilesEqual(file, historySessionFile)) return

      const match = findSession(file)
      const key = normalizeSessionFileKey(file) || file
      const cached = preparedByFile[key]
      try {
        if (match && (workspacePathsEqual(match.workspaceId, currentWorkspace) || !match.workspaceId)) {
          await switchSessionInPlace(match.sessionId, match.sessionFile || file)
          return
        }
        const prepared =
          cached ??
          (await ipcClient.invoke('session.prepare', { sessionFile: file, bind: false }))
        if (!prepared?.sessionId) return
        const workspace = prepared.workspaceId || match?.workspaceId || currentWorkspace
        if (!workspace) return
        const targetFile = prepared.sessionFile || file
        if (workspacePathsEqual(workspace, currentWorkspace)) {
          await switchSessionInPlace(prepared.sessionId, targetFile)
        } else {
          await activateWorkspace(workspace, {
            sessionId: prepared.sessionId,
            sessionFile: targetFile,
          })
        }
      } catch {
        /* ignore failed switch */
      }
    },
    [historySessionFile, findSession, preparedByFile, currentWorkspace],
  )

  if (collapsed || !enabled) return null

  const liveCount = counts.needsYou + counts.working + counts.done

  return (
    <section
      data-testid="sidebar-active-sessions-drawer"
      aria-label={t('common:sidebar.activeDrawer.title')}
      className="shrink-0 border-t border-border/50 bg-[var(--surface-sidebar)]"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 w-full cursor-pointer items-center gap-1.5 px-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/80"
          data-open={open ? 'true' : 'false'}
        />
        <span className="sidebar-section-title min-w-0 flex-1 truncate">
          {t('common:sidebar.activeDrawer.title')}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-foreground-secondary">
          {counts.needsYou > 0 ? (
            <span className="inline-flex items-center gap-1" title={t('common:attention.needsYou')}>
              <SessionAttentionDot attention="needs-you" />
              <span>{counts.needsYou}</span>
            </span>
          ) : null}
          {counts.working > 0 ? (
            <span className="inline-flex items-center gap-1" title={t('common:app.status.running')}>
              <SessionAttentionDot attention="working" />
              <span>{counts.working}</span>
            </span>
          ) : null}
          {counts.done > 0 ? (
            <span className="inline-flex items-center gap-1" title={t('common:attention.done')}>
              <SessionAttentionDot attention="done" />
              <span>{counts.done}</span>
            </span>
          ) : null}
          {liveCount === 0 && entries.length > 0 ? (
            <span className="text-[10px] text-foreground-secondary/60">{entries.length}</span>
          ) : null}
        </div>
      </button>

      <SidebarAnimatedCollapse open={open}>
        {entries.length === 0 ? (
          <div className="px-3 pb-2 pt-0.5 text-[11.5px] text-foreground-secondary/60">
            {t('common:sidebar.activeDrawer.empty')}
          </div>
        ) : (
          <div className="scrollbar-overlay max-h-[216px] space-y-0.5 overflow-y-auto px-1.5 pb-1.5 pt-0.5">
            {entries.map((entry) => {
              const match = findSession(entry.sessionFile)
              const key = normalizeSessionFileKey(entry.sessionFile) || entry.sessionFile
              const prepared = preparedByFile[key]
              const workspacePath =
                match?.workspaceId || prepared?.workspaceId || (match ? currentWorkspace : null)
              const projectName = workspacePath
                ? resolveProjectDisplayName(
                    projectDisplayNames,
                    workspacePath,
                    diskProjectName(workspacePath),
                  )
                : ''
              const customTitle = sessionDisplayNames[key] || sessionDisplayNames[entry.sessionFile]
              const rawTitle =
                customTitle ||
                match?.title ||
                match?.firstMessage ||
                entry.sessionFile.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, '') ||
                t('common:sidebar.newChat')
              const isCurrent = sessionFilesEqual(entry.sessionFile, historySessionFile)
              const isUnreadDone = entry.attention === 'done'
              const canDismiss = entry.attention === 'idle' || entry.attention === 'done'
              const statusText =
                entry.attention === 'needs-you'
                  ? t('common:attention.needsYou')
                  : entry.attention === 'working'
                    ? t('common:app.status.running')
                    : formatRelativeAge(
                        entry.lastActiveAt || match?.updatedAt || 0,
                        now,
                        t('common:sidebar.activeDrawer.justNow'),
                      )

              return (
                <div
                  key={entry.sessionFile}
                  data-drawer-session={entry.sessionFile}
                  data-attention={entry.attention}
                  className={cn(
                    'nav-row group relative flex min-h-[30px] items-center gap-2 rounded-lg px-2 py-1 text-[12.5px]',
                    isCurrent
                      ? 'nav-row-active text-foreground'
                      : 'text-foreground-secondary/90 hover:bg-[var(--bg-hover)] hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectSession(entry)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={projectName ? `${rawTitle} · ${projectName}` : rawTitle}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {entry.attention !== 'idle' ? (
                        <SessionAttentionDot attention={entry.attention} />
                      ) : (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-foreground-secondary/35"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        isUnreadDone && 'font-semibold text-foreground',
                        isCurrent && 'font-medium text-foreground',
                      )}
                    >
                      {rawTitle}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-[10.5px] tabular-nums text-foreground-secondary/65 transition-opacity',
                        canDismiss && 'group-hover:opacity-0',
                      )}
                    >
                      {[projectName, statusText].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  {canDismiss ? (
                    <button
                      type="button"
                      aria-label={t('common:sidebar.activeDrawer.dismiss')}
                      title={t('common:sidebar.activeDrawer.dismiss')}
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissRecentSession(entry.sessionFile)
                      }}
                      className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-foreground group-hover:opacity-80 focus-visible:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </SidebarAnimatedCollapse>
    </section>
  )
}
