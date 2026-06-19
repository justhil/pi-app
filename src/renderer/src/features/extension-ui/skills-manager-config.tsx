import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

type SkillRow = { name: string; description?: string; path?: string; source?: string }

export function SkillsManagerConfig({
  extensionId,
  onChange,
}: {
  extensionId: string
  onChange: (next: Record<string, unknown>) => void
}) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [disabled, setDisabled] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      ipcClient.invoke('skills.list'),
      workspace
        ? ipcClient.invoke('extension.config.get', { extensionId, workspaceId: workspace })
        : Promise.resolve({ config: {} }),
    ])
      .then(([listRes, cfgRes]) => {
        setSkills(listRes?.skills || [])
        const d = (cfgRes?.config?.disabledSkills as Record<string, boolean>) || {}
        setDisabled(d)
      })
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [extensionId, workspace])

  const persist = (nextDisabled: Record<string, boolean>) => {
    setDisabled(nextDisabled)
    onChange({ disabledSkills: nextDisabled })
  }

  const toggle = (name: string) => {
    const next = { ...disabled, [name]: !disabled[name] }
    if (!next[name]) delete next[name]
    persist(next)
  }

  if (loading) return <div className="text-[12px] text-muted-foreground/50">加载技能列表…</div>

  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-[12px] text-muted-foreground">
        Worker 未返回技能（请先打开项目并等待会话初始化）。列表来自 pi <code className="font-mono">resourceLoader.getSkills()</code>，与 TUI 一致。
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        已发现技能（{skills.length}）
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        「桌面禁用」仅影响本 App 内展示与 Composer 联想标记，<strong>不修改</strong> pi 的 settings 或扩展包。
      </p>
      <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border/50 p-2">
        {skills.map((sk) => {
          const off = !!disabled[sk.name]
          return (
            <div
              key={sk.name}
              className={cn(
                'flex items-start justify-between gap-3 rounded-md px-2 py-1.5',
                off ? 'bg-muted/40 opacity-70' : 'hover:bg-accent/30',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] font-medium">{sk.name}</div>
                {sk.description && (
                  <div className="truncate text-[11px] text-muted-foreground">{sk.description}</div>
                )}
                {sk.source && <div className="text-[10px] text-muted-foreground/50">{sk.source}</div>}
              </div>
              <button
                type="button"
                onClick={() => toggle(sk.name)}
                className={cn(
                  'shrink-0 rounded px-2 py-0.5 text-[10px] font-medium',
                  off ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
                )}
              >
                {off ? '已禁用' : '启用'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}