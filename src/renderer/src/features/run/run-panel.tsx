import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useState } from 'react'
import { Clock, Coins, Wrench, AlertCircle, Cpu, Activity, Timer } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
}

function StatCard({ icon: Icon, label, value, sublabel, accent }: any) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn('mt-1 text-[15px] font-semibold tabular-nums', accent || 'text-foreground')}>
        {value}
      </div>
      {sublabel && <div className="text-[10px] text-muted-foreground/50">{sublabel}</div>}
    </div>
  )
}

export function RunPanel() {
  const runState = useUIStore((s) => s.runState)
  const [elapsed, setElapsed] = useState('0s')

  useEffect(() => {
    if (runState.status === 'running' && runState.startTime) {
      const timer = setInterval(() => {
        setElapsed(formatDuration(Date.now() - runState.startTime!))
      }, 1000)
      return () => clearInterval(timer)
    }
    setElapsed('0s')
  }, [runState.status, runState.startTime])

  const isRunning = runState.status === 'running'
  const totalTokens = runState.usage ? runState.usage.input + runState.usage.output : 0

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 space-y-2.5">
      {/* Status */}
      <div className={cn(
        'flex items-center gap-2.5 rounded-lg border p-2.5 transition-all duration-motion-normal ease-motion-ease',
        isRunning
          ? 'border-green-500/30 bg-green-500/5'
          : runState.status === 'failed'
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-border/60 bg-muted/20'
      )}>
        <div className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg',
          isRunning ? 'bg-green-500/10' : 'bg-muted'
        )}>
          <Activity className={cn(
            'h-4 w-4',
            isRunning ? 'text-green-500 animate-pulse' : 'text-muted-foreground/60'
          )} />
        </div>
        <div>
          <div className="text-[13px] font-semibold">
            {isRunning ? '运行中' : runState.status === 'failed' ? '失败' : '空闲'}
          </div>
          {isRunning && runState.activeTool && (
            <div className="text-[11px] text-muted-foreground">
              正在执行: <span className="font-mono text-foreground/70">{runState.activeTool}</span>
            </div>
          )}
        </div>
      </div>

      {/* Model */}
      {runState.model && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="truncate font-mono text-[12px] text-foreground/80">{runState.model}</span>
          {runState.thinkingLevel && runState.thinkingLevel !== 'off' && (
            <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase">
              {runState.thinkingLevel}
            </span>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={Timer} label="耗时" value={elapsed} accent={isRunning ? 'text-green-600 dark:text-green-400' : undefined} />
        <StatCard icon={Wrench} label="工具" value={runState.toolCount.toString()} sublabel={runState.errorCount > 0 ? `${runState.errorCount} 错误` : '无错误'} accent={runState.errorCount > 0 ? undefined : undefined} />
      </div>

      {/* Token usage */}
      {runState.usage && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-card/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            <Coins className="h-3 w-3" />
            Token 用量
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground/60">输入</span>
              <span className="tabular-nums">{runState.usage.input.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground/60">输出</span>
              <span className="tabular-nums">{runState.usage.output.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground/60">缓存读</span>
              <span className="tabular-nums">{runState.usage.cacheRead.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground/60">缓存写</span>
              <span className="tabular-nums">{runState.usage.cacheWrite.toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">费用</span>
            <span className="font-mono text-[13px] font-semibold text-foreground">
              ${runState.usage.cost.toFixed(4)}
            </span>
          </div>
        </div>
      )}

      {/* Error count */}
      {runState.errorCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-[12px] text-destructive">{runState.errorCount} 个错误</span>
        </div>
      )}
    </div>
  )
}
