import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, ListTree, BookOpen, FolderTree } from 'lucide-react'

interface TrellisData {
  hasTrellis: boolean
  currentTask?: {
    name: string
    status: string
    title: string
    priority?: string
  }
  phase?: string
  acceptanceCriteria?: string[]
  recentJournals?: { title: string; date: string; lines: number }[]
}

export function TrellisPanel() {
  const { t } = useTranslation()
  const [data, setData] = useState<TrellisData>({ hasTrellis: false })

  useEffect(() => {
    // Placeholder - TrellisReader will be called via IPC
    // For now, just show the empty state
    setData({ hasTrellis: false })
  }, [])

  if (!data.hasTrellis) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FolderTree className="h-8 w-8 text-muted-foreground/40" />
        <div className="text-xs text-muted-foreground/60">
          当前项目未启用 Trellis
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 space-y-3">
      {/* Current task */}
      {data.currentTask && (
        <div className="rounded-md border border-border bg-muted/20 p-2.5">
          <div className="text-xs font-medium text-muted-foreground mb-1">当前任务</div>
          <div className="text-sm font-semibold">{data.currentTask.title || data.currentTask.name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5">{data.currentTask.status}</span>
            {data.currentTask.priority && (
              <span className="rounded bg-muted px-1.5 py-0.5">{data.currentTask.priority}</span>
            )}
          </div>
        </div>
      )}

      {/* Phase */}
      {data.phase && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListTree className="h-3.5 w-3.5" />
          <span>阶段: {data.phase}</span>
        </div>
      )}

      {/* Acceptance criteria */}
      {data.acceptanceCriteria && data.acceptanceCriteria.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CheckSquare className="h-3.5 w-3.5" />
            <span>验收条件</span>
          </div>
          {data.acceptanceCriteria.map((ac, i) => (
            <div key={i} className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
              <span className="mt-0.5 text-muted-foreground/50">{i + 1}.</span>
              <span>{ac}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent journals */}
      {data.recentJournals && data.recentJournals.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            <span>最近记录</span>
          </div>
          {data.recentJournals.map((j, i) => (
            <div key={i} className="rounded-md border border-border px-2 py-1.5 text-xs">
              <div className="font-medium">{j.title}</div>
              <div className="text-muted-foreground">{j.date} · {j.lines} 行</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
