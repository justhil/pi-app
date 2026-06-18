import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useState } from 'react'
import { Clock, Coins, Wrench, AlertCircle, Cpu } from 'lucide-react'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs}s`
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
  }, [runState.status, runState.startTime])

  const isRunning = runState.status === 'running'

  return (
    <div className="flex h-full flex-col p-3 space-y-3">
      {/* Status */}
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isRunning ? 'bg-green-500 animate-pulse' : runState.status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground/40'
          }`}
        />
        <span className="text-sm font-medium">
          {isRunning ? '运行中' : runState.status === 'failed' ? '失败' : '空闲'}
        </span>
        {isRunning && (
          <div className="ml-auto h-1 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </div>

      {/* Model */}
      {runState.model && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" />
          <span className="font-mono">{runState.model}</span>
          {runState.thinkingLevel && runState.thinkingLevel !== 'off' && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{runState.thinkingLevel}</span>
          )}
        </div>
      )}

      {/* Duration */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span>{elapsed}</span>
      </div>

      {/* Usage */}
      {runState.usage && (
        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            <span>Token 用量</span>
          </div>
          <div className="grid grid-cols-2 gap-1 font-mono">
            <span className="text-muted-foreground">输入: {runState.usage.input.toLocaleString()}</span>
            <span className="text-muted-foreground">输出: {runState.usage.output.toLocaleString()}</span>
            <span className="text-muted-foreground">缓存读: {runState.usage.cacheRead.toLocaleString()}</span>
            <span className="text-muted-foreground">缓存写: {runState.usage.cacheWrite.toLocaleString()}</span>
          </div>
          <div className="border-t border-border pt-1 font-mono text-foreground">
            费用: ${runState.usage.cost.toFixed(4)}
          </div>
        </div>
      )}

      {/* Tool stats */}
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          <span>工具: {runState.toolCount}</span>
        </div>
        {runState.errorCount > 0 && (
          <div className="flex items-center gap-1.5 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>错误: {runState.errorCount}</span>
          </div>
        )}
      </div>

      {/* Active tool */}
      {runState.activeTool && (
        <div className="text-xs text-muted-foreground animate-pulse">
          正在执行: <span className="font-mono text-foreground">{runState.activeTool}</span>
        </div>
      )}
    </div>
  )
}
