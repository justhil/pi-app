import { cn } from '@renderer/lib/utils'
import { GitBranch, Users } from 'lucide-react'

function parseSubagent(details: any, toolName: string) {
  if (!details) return null
  if (toolName === 'trellis_subagent') {
    return {
      mode: 'trellis',
      runId: details.runId,
      results: [{ agent: details.agent, status: details.status, error: details.error }],
      progressSummary: undefined as any,
    }
  }
  if (toolName === 'subagent' || toolName === 'contact_supervisor') {
    const results = Array.isArray(details.results) ? details.results : []
    return {
      mode: details.mode || toolName,
      runId: details.runId || details.asyncId,
      results: results.map((r: any) => ({
        agent: r.agent || r.name,
        status: r.status || r.state,
        error: r.error,
      })),
      progressSummary: details.progressSummary,
    }
  }
  return null
}

export function SubagentToolCard({ item }: { item: any }) {
  const summary = parseSubagent(item.toolDetails, item.toolName)
  if (!summary) {
    const out = (item.toolOutput || '').slice(0, 1200)
    return (
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-muted/40 p-2 text-[11px] text-muted-foreground">
        {out || '(无结构化结果)'}
      </pre>
    )
  }

  const Icon = item.toolName === 'trellis_subagent' ? GitBranch : Users

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-blue-500" />
        <span className="font-mono uppercase">{summary.mode || item.toolName}</span>
        {summary.runId && <span className="truncate font-mono">{summary.runId}</span>}
      </div>
      {summary.progressSummary && (
        <div className="flex gap-3 text-[10px] tabular-nums text-muted-foreground">
          {summary.progressSummary.running != null && <span>运行 {summary.progressSummary.running}</span>}
          {summary.progressSummary.completed != null && <span>完成 {summary.progressSummary.completed}</span>}
          {summary.progressSummary.failed != null && <span>失败 {summary.progressSummary.failed}</span>}
        </div>
      )}
      <div className="space-y-1">
        {summary.results.length === 0 && (
          <div className="text-[11px] text-muted-foreground/60">无子任务条目（可能为管理类 action）</div>
        )}
        {summary.results.map((r, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md border border-border/40 px-2 py-1',
              r.status === 'failed' || r.status === 'timedOut' ? 'border-destructive/30 bg-destructive/5' : 'bg-background/50',
            )}
          >
            <span className="font-mono text-[11px]">{r.agent || 'agent'}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{r.status || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}