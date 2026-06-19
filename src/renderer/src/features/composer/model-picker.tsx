// Model picker panel: shows current model + searchable list, /model opens this instead of silent cycle.

import { useEffect, useMemo, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Search, Check, Cpu } from 'lucide-react'
import { toast } from 'sonner'

export function ModelPicker() {
  const open = useUIStore((s) => s.modelPickerOpen)
  const setOpen = useUIStore((s) => s.setModelPickerOpen)
  const currentModel = useUIStore((s) => s.runState.model)
  const [models, setModels] = useState<any[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    ipcClient.invoke('model.list').then((res) => setModels(res?.models || [])).catch(() => {})
  }, [open])

  const filtered = useMemo(() => {
    if (!query) return models
    const q = query.toLowerCase()
    return models.filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))
  }, [models, query])

  if (!open) return null

  const pick = async (m: any) => {
    try {
      await ipcClient.invoke('model.set', { sessionId: '', provider: m.provider, modelId: m.id })
      toast.success(`已切换到 ${m.provider}/${m.id}`)
    } catch (e) {
      console.error('model.set failed:', e)
      toast.error('切换失败')
    }
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 p-4 pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground/70" />
            <div>
              <div className="text-[14px] font-medium">选择模型</div>
              <div className="text-[11px] text-muted-foreground">
                当前：<span className="font-mono">{currentModel || '未选择'}</span>
              </div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 provider / modelId / 名称…"
              className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/50">
              {models.length === 0 ? '无可用模型（检查 ~/.pi/agent/auth.json）' : '无匹配'}
            </div>
          )}
          {filtered.map((m) => {
            const key = `${m.provider}/${m.id}`
            const active = currentModel === key
            return (
              <button
                key={key}
                onClick={() => pick(m)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors',
                  active ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-medium">{m.provider}/{m.id}</span>
                    {!m.available && <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">不可用</span>}
                  </div>
                  {m.name && m.name !== m.id && (
                    <div className="truncate text-[11px] text-muted-foreground/60">{m.name}</div>
                  )}
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground/60">
          <span>共 {models.length} 个，显示 {filtered.length} 个</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}