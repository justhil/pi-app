import { useEffect, useState } from 'react'
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
  const [data, setData] = useState<TrellisData>({ hasTrellis: false })

  useEffect(() => {
    setData({ hasTrellis: false })
  }, [])

  if (!data.hasTrellis) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/30 text-muted-foreground/30">
          <FolderTree className="h-6 w-6" />
        </div>
        <div className="text-[12px] text-muted-foreground/50">
          当前项目未启用 Trellis
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 space-y-3">
      {data.currentTask && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1">当前任务</div>
          <div className="text-[13px] font-semibold">{data.currentTask.title || data.currentTask.name}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{data.currentTask.status}</span>
            {data.currentTask.priority && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{data.currentTask.priority}</span>
            )}
          </div>
        </div>
      )}

      {data.phase && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <ListTree className="h-3.5 w-3.5" />
          <span>阶段: <span className="text-foreground/80">{data.phase}</span></span>
        </div>
      )}

      {data.acceptanceCriteria && data.acceptanceCriteria.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            <CheckSquare className="h-3 w-3" />
            验收条件
          </div>
          {data.acceptanceCriteria.map((ac, i) => (
            <div key={i} className="flex items-start gap-2 px-1 text-[12px] text-muted-foreground/80">
              <span className="mt-0.5 text-muted-foreground/40 tabular-nums">{i + 1}.</span>
              <span className="leading-relaxed">{ac}</span>
            </div>
          ))}
        </div>
      )}

      {data.recentJournals && data.recentJournals.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            <BookOpen className="h-3 w-3" />
            最近记录
          </div>
          {data.recentJournals.map((j, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5">
              <div className="text-[12px] font-medium">{j.title}</div>
              <div className="text-[10px] text-muted-foreground/50 tabular-nums">{j.date} · {j.lines} 行</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
