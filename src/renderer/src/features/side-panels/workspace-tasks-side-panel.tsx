import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, ListTree, BookOpen, RefreshCw, ChevronRight } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import type { SidePanelComponentProps } from './side-panel-registry'

interface TaskRow {
  name: string
  title: string
  status: string
  priority?: string
  description?: string
  assignee?: string
  subtasks?: string[]
  acceptanceCriteria?: string[]
  isCurrent?: boolean
}

interface TasksPanelState {
  ready: boolean
  currentTaskName?: string
  tasks: TaskRow[]
  recentJournals?: { title: string; date: string; lines: number; preview: string }[]
}

// Task status labels come from adapters:tasks.status.* so the panel follows the UI language.

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-green-500/15 text-green-600 dark:text-green-400',
  planning: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  review: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-muted text-muted-foreground',
}

export function WorkspaceTasksSidePanel({ panelId, adapterId }: SidePanelComponentProps) {
  const [data, setData] = useState<TasksPanelState>({ ready: false, tasks: [] })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const { t } = useTranslation()

  const fetchData = async () => {
    if (!workspace || !adapterId) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await ipcClient.invoke('adapter.sidePanel.getState', {
        adapterId,
        workspaceId: workspace,
      })
      if (!result?.ok) {
        setLoadError(result?.error || 'load_failed')
        setData({ ready: false, tasks: [] })
        return
      }
      const raw = result.state as { ready?: boolean; hasTrellis?: boolean; tasks?: TaskRow[]; recentJournals?: TasksPanelState['recentJournals'] }
      const state: TasksPanelState = {
        ready: raw?.ready ?? raw?.hasTrellis ?? false,
        tasks: raw?.tasks || [],
        recentJournals: raw?.recentJournals,
      }
      setData(state)
      const current = state.tasks?.find((t) => t.isCurrent)
      setExpandedTask(current?.name || state.tasks?.[0]?.name || null)
    } catch (e) {
      console.error('[workspace-tasks] load failed:', e)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (workspace && adapterId) void fetchData()
    else setData({ ready: false, tasks: [] })
  }, [workspace, adapterId])

  if (!adapterId) {
    return <div className="p-4 text-[12px] text-muted-foreground">{t('adapters:tasks.noAdapterId', { panelId })}</div>
  }

  if (!workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-[12px] text-muted-foreground/50">{t('adapters:tasks.openProjectFirst')}</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-[12px] text-muted-foreground/50">{t('adapters:tasks.loadFailed')}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40">{loadError}</span>
        <button type="button" onClick={fetchData} className="text-[11px] text-primary hover:underline">{t('adapters:tasks.retry')}</button>
      </div>
    )
  }

  if (!data.ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-[12px] text-muted-foreground/50">{t('adapters:tasks.noLayout')}</span>
        <span className="text-[10px] text-muted-foreground/40">{t('adapters:tasks.needsTrellis')}</span>
      </div>
    )
  }

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-end px-2 py-1.5 border-b border-border/40">
        <button
          onClick={fetchData}
          disabled={loading}
          className="rounded p-1 text-muted-foreground/40 hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Task list */}
      {data.tasks.length > 0 && (
        <div className="px-2 py-1.5 space-y-1">
          <div className="px-1 pb-1 text-[12px] text-foreground-secondary">
            {t('adapters:tasks.activeCount', { count: data.tasks.length })}
          </div>
          {data.tasks.map((task) => {
            const isExpanded = expandedTask === task.name
            return (
              <div key={task.name} className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
                <button
                  onClick={() => setExpandedTask(isExpanded ? null : task.name)}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-accent/40 transition-all duration-motion-fast ease-motion-ease"
                >
                  <ChevronRight className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-motion-fast',
                    isExpanded && 'rotate-90'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {task.isCurrent && (
                        <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" title={t('adapters:tasks.currentTask')} />
                      )}
                      <span className="truncate text-[12px] font-medium leading-tight">{task.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', STATUS_COLORS[task.status] || 'bg-muted text-muted-foreground')}>
                        {t(`adapters:tasks.status.${task.status}`, { defaultValue: task.status })}
                      </span>
                      {task.priority && (
                        <span className="text-[9px] font-mono text-muted-foreground/50">{task.priority}</span>
                      )}
                      {task.subtasks && task.subtasks.length > 0 && (
                        <span className="text-[9px] text-muted-foreground/50">{t('adapters:tasks.subtaskCount', { count: task.subtasks.length })}</span>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/30 px-2.5 py-2 space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-motion-fast ease-motion-ease">
                    {/* Description */}
                    {task.description && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground/80">{task.description}</p>
                    )}

                    {/* Subtasks */}
                    {task.subtasks && task.subtasks.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1">
                          <ListTree className="h-3 w-3" />
                          {t('adapters:tasks.subtasks')}
                        </div>
                        {task.subtasks.map((st, i) => (
                          <div key={i} className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground/70">
                            <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                            <span className="font-mono">{st}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Acceptance criteria */}
                    {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1">
                          <CheckSquare className="h-3 w-3" />
                          {t('adapters:tasks.acceptance')}
                        </div>
                        {task.acceptanceCriteria.map((ac, i) => (
                          <div key={i} className="flex items-start gap-1.5 py-0.5 text-[11px] text-muted-foreground/80">
                            <span className="mt-0.5 text-muted-foreground/40 tabular-nums">{i + 1}.</span>
                            <span className="leading-relaxed">{ac}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Meta */}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/40">
                      {task.assignee && <span>@{task.assignee}</span>}
                      <span className="font-mono">{task.name}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty tasks */}
      {data.tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
          <span className="text-[12px] text-foreground-secondary/70">{t('adapters:tasks.empty')}</span>
        </div>
      )}

      {/* Journals */}
      {data.recentJournals && data.recentJournals.length > 0 && (
        <div className="px-2 py-1.5 space-y-1 border-t border-border/40 mt-1">
          <div className="px-1 pb-1 text-[12px] text-foreground-secondary">
            {t('adapters:tasks.journals')}
          </div>
          {data.recentJournals.map((j, i) => (
            <div key={i} className="rounded-lg border border-border/30 bg-card/20 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                <span className="truncate text-[11px] font-medium">{j.title}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/40">
                <span className="font-mono">{j.date}</span>
                <span>{t('adapters:tasks.lines', { count: j.lines })}</span>
              </div>
              {j.preview && (
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground/40">{j.preview}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
