import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Plus, Search, MessageSquare, Clock } from 'lucide-react'
import { useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'

export function SessionList() {
  const { t } = useTranslation()
  const sessions = useUIStore((s) => s.sessions)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const setCurrentSession = useUIStore((s) => s.setCurrentSession)
  const loadHistoryItems = useUIStore((s) => s.loadHistoryItems)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)

  const handleOpenSession = async (sessionId: string, sessionFile?: string) => {
    setCurrentSession(sessionId)
    if (sessionFile) {
      // Only fetch history for display; loadSession into worker deferred until user sends a prompt
      try {
        const res = await ipcClient.invoke('session.getMessages', { sessionFile })
        if (res?.items) loadHistoryItems(res.items)
        else loadHistoryItems([])
      } catch {
        loadHistoryItems([])
      }
    } else {
      loadHistoryItems([])
    }
  }

  const handleNewSession = async () => {
    if (!currentWorkspace) return
    try {
      const res = await ipcClient.invoke('session.new', { workspaceId: currentWorkspace })
      if (res?.session) {
        // Refresh list
        const listRes = await ipcClient.invoke('session.list', { workspaceId: currentWorkspace })
        if (listRes?.sessions) {
          useUIStore.getState().setSessions(listRes.sessions)
        }
      }
    } catch (e) {
      console.error('New session failed:', e)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {t('sidebar.sessions')}
        </span>
        <button
          onClick={handleNewSession}
          disabled={!currentWorkspace}
          className="rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease disabled:opacity-30 disabled:pointer-events-none"
          title="新建会话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {sessions.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground/40">
          {currentWorkspace ? '暂无会话' : '请先打开项目'}
        </div>
      ) : (
        <div className="space-y-px px-1.5">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => handleOpenSession(s.sessionId, s.sessionFile)}
              className={cn(
                'group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-motion-fast ease-motion-ease',
                currentSessionId === s.sessionId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <MessageSquare className={cn(
                'h-3 w-3 shrink-0 transition-colors',
                currentSessionId === s.sessionId ? 'text-foreground' : 'text-muted-foreground/40 group-hover:text-muted-foreground'
              )} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12px] font-medium leading-tight">
                  {s.title || s.sessionId.slice(0, 8)}
                </div>
                <div className="text-[10px] text-muted-foreground/50 tabular-nums">
                  {new Date(s.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectHeader() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const name = workspace ? workspace.split(/[\\/]/).pop() : '未选择项目'

  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-border/80 px-3">
      <div className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold',
        workspace ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
      )}>
        {workspace ? name.charAt(0).toUpperCase() : '?'}
      </div>
      <span className="truncate text-[13px] font-semibold tracking-tight">{name}</span>
    </div>
  )
}
