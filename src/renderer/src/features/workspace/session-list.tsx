import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Plus, Settings as SettingsIcon, Folder } from 'lucide-react'

export function SessionList() {
  const { t } = useTranslation()
  const sessions = useUIStore((s) => s.sessions)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const setCurrentSession = useUIStore((s) => s.setCurrentSession)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t('sidebar.sessions')}</span>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-motion-fast ease-motion-ease"
          title="新建会话"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {sessions.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground/60">
          暂无会话
        </div>
      ) : (
        <div className="space-y-0.5">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => setCurrentSession(s.sessionId)}
              className={cn(
                'mx-2 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors duration-motion-fast ease-motion-ease',
                currentSessionId === s.sessionId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <MessageSquare className="h-3 w-3 shrink-0 opacity-50" />
              <span className="truncate">{s.title || s.sessionId.slice(0, 8)}</span>
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
    <div className="flex h-12 items-center gap-2 border-b border-border px-3">
      <Folder className="h-4 w-4 text-muted-foreground" />
      <span className="truncate text-sm font-semibold">{name}</span>
    </div>
  )
}
