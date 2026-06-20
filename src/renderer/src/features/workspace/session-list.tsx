import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Plus, Search, MessageSquare, Clock, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { syncRunStateFromWorker } from '@renderer/lib/sync-run-state'

export function SessionList() {
  const { t } = useTranslation()
  const sessions = useUIStore((s) => s.sessions)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const collapsed = useUIStore((s) => s.sidebarCollapsed)

  const handleOpenSession = (sessionId: string, sessionFile?: string) => {
    void openSessionIntoWorker(sessionId, sessionFile)
  }

  const handleNewSession = async () => {
    if (!currentWorkspace) return
    try {
      const res = await ipcClient.invoke('session.new', { workspaceId: currentWorkspace })
      if (res?.session) {
        const listRes = await ipcClient.invoke('session.list', { workspaceId: currentWorkspace })
        if (listRes?.sessions) useUIStore.getState().setSessions(listRes.sessions)
        useUIStore.getState().setCurrentSession(res.session.sessionId)
        useUIStore.getState().loadHistoryItems([])
        useUIStore.getState().clearFileChanges()
        await syncRunStateFromWorker()
      }
    } catch (e) {
      console.error('New session failed:', e)
    }
  }

  return (
    <div className="flex flex-col">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-1">
          <button
            onClick={handleNewSession}
            disabled={!currentWorkspace}
            title="新建会话"
            className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
          {sessions.slice(0, 6).map((s) => (
            <div
              key={s.sessionId}
              onClick={() => handleOpenSession(s.sessionId, s.sessionFile)}
              title={s.title || s.sessionId.slice(0, 8)}
              className={cn(
                'nav-row flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
                currentSessionId === s.sessionId ? 'nav-row-active text-foreground' : 'text-foreground-secondary hover:text-foreground',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </div>
          ))}
        </div>
      ) : (
      <>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="sidebar-label-fade sider-label-motion text-[13px] font-semibold text-foreground-secondary">
          {t('sidebar.sessions')}
        </span>
        <button
          onClick={handleNewSession}
          disabled={!currentWorkspace}
          className="chrome-icon-btn rounded-md p-1 text-foreground-secondary disabled:opacity-30 disabled:pointer-events-none"
          title="新建会话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {sessions.length === 0 ? (
        <div className="px-3 py-3 text-[13px] text-foreground-secondary">
          {currentWorkspace ? '暂无会话' : '请先打开项目'}
        </div>
      ) : (
        <div className="space-y-0.5 px-1.5">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => handleOpenSession(s.sessionId, s.sessionFile)}
              className={cn(
                'group nav-row sider-item-motion flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2',
                currentSessionId === s.sessionId
                  ? 'nav-row-active text-foreground'
                  : 'text-foreground-secondary hover:text-foreground',
              )}
            >
              <MessageSquare className={cn(
                'h-4 w-4 shrink-0 transition-colors',
                currentSessionId === s.sessionId ? 'text-foreground' : 'text-foreground-secondary/70 group-hover:text-foreground'
              )} />
              <div className="flex-1 min-w-0">
                <div className="sidebar-label-fade truncate text-[14px] font-normal leading-6 text-foreground">
                  {s.title || s.sessionId.slice(0, 8)}
                </div>
                <div className="sidebar-label-fade text-[12px] leading-5 text-foreground-secondary tabular-nums">
                  {new Date(s.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}

export function ProjectHeader() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const name = workspace ? workspace.split(/[\\/]/).pop() : '未选择'

  if (collapsed) {
    return (
      <div className="flex h-11 items-center justify-center border-b border-border/50">
        <div className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold',
          workspace ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )} title={workspace ? name : '未选择项目'}>
          {workspace ? name.charAt(0).toUpperCase() : '?'}
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-border/50 px-3">
      <div className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold',
        workspace ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
      )}>
        {workspace ? name.charAt(0).toUpperCase() : '?'}
      </div>
      <span className="sidebar-label-fade truncate text-[14px] font-semibold leading-6 text-foreground">{name}</span>
    </div>
  )
}

export function OpenProjectButton({ onClick, label }: { onClick: () => void; label: string }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  if (collapsed) {
    return (
      <div className="py-1.5">
        <button
          onClick={onClick}
          title={label}
          className="chrome-icon-btn mx-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-foreground-secondary"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
  return (
    <div className="px-2 py-1">
      <button
        onClick={onClick}
        className="nav-row row-hover flex w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[14px] leading-6 text-foreground-secondary hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="sidebar-label-fade">{label}</span>
      </button>
    </div>
  )
}
