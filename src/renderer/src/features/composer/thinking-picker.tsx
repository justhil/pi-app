// Thinking level picker: shows all levels with descriptions, /thinking opens this.

import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Brain, Check } from 'lucide-react'
import { toast } from 'sonner'

const LEVELS: { key: string; label: string; desc: string }[] = [
  { key: 'off', label: 'Off', desc: '不思考，直接回答' },
  { key: 'minimal', label: 'Minimal', desc: '极简思考' },
  { key: 'low', label: 'Low', desc: '轻度思考' },
  { key: 'medium', label: 'Medium', desc: '中等思考（默认）' },
  { key: 'high', label: 'High', desc: '深度思考' },
  { key: 'xhigh', label: 'XHigh', desc: '极致思考（耗时/token 多）' },
]

export function ThinkingPicker() {
  const open = useUIStore((s) => s.thinkingPickerOpen)
  const setOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const current = useUIStore((s) => s.runState.thinkingLevel || 'medium')

  if (!open) return null

  const pick = async (level: string) => {
    try {
      await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level })
      useUIStore.getState().setRunState({ thinkingLevel: level })
      toast.success(`Thinking: ${level}`)
    } catch (e) {
      console.error('thinkingLevel.set failed:', e)
      toast.error('切换失败')
    }
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 p-4 pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground/70" />
            <div className="text-[14px] font-medium">Thinking 等级</div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-1">
          {LEVELS.map((lv) => {
            const active = current === lv.key
            return (
              <button
                key={lv.key}
                onClick={() => pick(lv.key)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  active ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-medium uppercase">{lv.label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground/60">{lv.desc}</div>
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}