import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useState } from 'react'
import { Clock, Coins, Wrench, AlertCircle, Cpu, Activity, Timer, ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'

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
  const [models, setModels] = useState<any[]>([])
  const [showModelMenu, setShowModelMenu] = useState(false)

  useEffect(() => {
    ipcClient.invoke('model.list').then((res) => setModels(res?.models || [])).catch(() => {})
  }, [])

  const switchModel = async (provider: string, modelId: string) => {
    try {
      await ipcClient.invoke('model.set', { sessionId: '', provider, modelId })
      useUIStore.getState().setRunState({ model: `${provider}/${modelId}` })
    } catch (e) {
      console.error('model.set failed:', e)
    }
    setShowModelMenu(false)
  }

  const cycleThinking = async () => {
    const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    const cur = runState.thinkingLevel || 'medium'
    const next = order[(order.indexOf(cur) + 1) % order.length]
    try {
      await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level: next })
      useUIStore.getState().setRunState({ thinkingLevel: next })
    } catch (e) {
      console.error('thinkingLevel.set failed:', e)
    }
  }

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

      {/* Model selector */}
      <div className="relative">
        <button
          onClick={() => setShowModelMenu((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 text-left hover:bg-accent/40"
        >
          <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="truncate font-mono text-[12px] text-foreground/80">{runState.model || '未选择'}</span>
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/60" />
        </button>
        {showModelMenu && (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border/70 bg-popover shadow-lg">
            {models.length === 0 && <div className="px-2.5 py-2 text-[11px] text-muted-foreground/60">无可用模型</div>}
            {models.map((m: any) => (
              <button
                key={`${m.provider}/${m.id}`}
                onClick={() => switchModel(m.provider, m.id)}
                className={cn(
                  'flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] hover:bg-accent',
                  runState.model === `${m.provider}/${m.id}` && 'bg-accent/60'
                )}
              >
                <span className="font-mono">{m.provider}/{m.id}</span>
                {!m.available && <span className="text-[10px] text-muted-foreground/50">不可用</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thinking toggle */}
      <button
        onClick={cycleThinking}
        className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 text-left hover:bg-accent/40"
      >
        <span className="text-[12px] text-muted-foreground">Thinking 等级</span>
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
          (runState.thinkingLevel || 'off') === 'off' ? 'bg-muted text-muted-foreground' : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
        )}>
          {runState.thinkingLevel || 'off'}
        </span>
      </button>

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
