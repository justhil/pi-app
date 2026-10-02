import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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

  if (loading) return <div className="text-[12px] text-muted-foreground/50">{t('extension:skillsLoading')}</div>

  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-[12px] text-muted-foreground">
        {t('extension:skillsEmptyBefore')} <code className="font-mono">resourceLoader.getSkills()</code>
        {t('extension:skillsEmptyAfter')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
        {t('extension:skillsFound', { count: skills.length })}
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        {t('extension:skillsDesktopOnlyBefore')}<strong>{t('extension:skillsDesktopOnlyStrong')}</strong>
        {t('extension:skillsDesktopOnlyAfter')}
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
                <div className="font-mono text-[12px] text-foreground">{sk.name}</div>
                {sk.description && (
                  <div className="truncate text-[11px] text-muted-foreground">{sk.description}</div>
                )}
                {sk.source && <div className="text-[10px] text-muted-foreground/50">{sk.source}</div>}
              </div>
              <button
                type="button"
                onClick={() => toggle(sk.name)}
                aria-pressed={!off}
                className={cn(
                  'shrink-0 rounded px-2 py-0.5 text-[10px] font-medium',
                  off ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
                )}
              >
                {off ? t('extension:skillDisabled') : t('extension:skillEnabled')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}