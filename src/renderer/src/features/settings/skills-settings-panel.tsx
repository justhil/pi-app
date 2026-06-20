import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'

type SkillRow = {
  name: string
  description: string
  path?: string
  source?: string
  key: string
  enabled: boolean
  command: string
}

export function SkillsSettingsPanel() {
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await ipcClient.invoke('skills.list')
      setSkills(res?.skills || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (row: SkillRow) => {
    const next = !row.enabled
    setSkills((prev) => prev.map((s) => (s.key === row.key ? { ...s, enabled: next } : s)))
    await ipcClient.invoke('skills.setEnabled', { key: row.key, name: row.name, path: row.path, enabled: next })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Skills</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/75 leading-relaxed">
            默认全部启用。启停写入 <code className="rounded bg-muted px-1 text-[10px]">~/.pi/agent/settings.json</code> 的{' '}
            <code className="text-[10px]">desktopSkillOverrides</code>（与终端 pi 共用全局配置，项目设置继承全局）。
          </p>
        </div>
        <button type="button" className="rounded-md p-2 hover:bg-muted" title="刷新" onClick={() => void load()}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/20">
        {loading ? (
          <p className="p-4 text-[12px] text-muted-foreground">加载…</p>
        ) : skills.length === 0 ? (
          <p className="p-4 text-[12px] text-muted-foreground">未发现 skill（先打开工作区）</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {skills.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  onClick={() => void toggle(s)}
                  className={cn(
                    'h-5 w-9 shrink-0 rounded-full transition-colors',
                    s.enabled ? 'bg-primary' : 'bg-muted-foreground/25',
                  )}
                >
                  <span
                    className={cn(
                      'block h-4 w-4 rounded-full bg-white shadow transition-transform',
                      s.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[13px] font-medium">{s.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{s.command}</span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide',
                        s.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {s.enabled ? '启用' : '禁用'}
                    </span>
                  </div>
                  {s.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{s.description}</p>
                  ) : null}
                  <p className="mt-0.5 text-[10px] text-muted-foreground/55">
                    {s.source}
                    {s.path ? ` · ${s.path}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}