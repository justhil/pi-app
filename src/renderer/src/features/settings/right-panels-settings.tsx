import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { LayoutPanelLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  RIGHT_PANEL_CATALOG,
  RIGHT_PANEL_IDS,
  defaultRightPanelPrefs,
  normalizeRightPanelPrefs,
  type RightPanelPrefs,
} from '@shared/right-panels'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors duration-motion-fast ease-motion-ease disabled:opacity-40',
        on ? 'bg-primary' : 'bg-muted-foreground/20',
      )}
      aria-pressed={on}
    >
      <div
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-motion-fast ease-motion-ease',
          on ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function RightPanelsSettings() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<RightPanelPrefs>(() => defaultRightPanelPrefs())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await ipcClient.invoke('settings.get', { key: 'rightPanelPrefs' })
    const next = normalizeRightPanelPrefs(res?.settings?.rightPanelPrefs)
    setPrefs(next)
    useUIStore.getState().applyRightPanelPrefs(next)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const enabledCount = RIGHT_PANEL_IDS.filter((id) => prefs[id]).length

  const persist = async (next: RightPanelPrefs) => {
    setSaving(true)
    try {
      await ipcClient.invoke('settings.set', { key: 'rightPanelPrefs', value: next })
      useUIStore.getState().applyRightPanelPrefs(next)
      setPrefs(next)
      toast.success('右侧栏已更新')
    } catch (e) {
      console.error(e)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const setOne = (id: (typeof RIGHT_PANEL_IDS)[number], on: boolean) => {
    if (!on && enabledCount <= 1) {
      toast.message('至少保留一个栏目')
      return
    }
    const next = { ...prefs, [id]: on }
    void persist(next)
  }

  const resetDefaults = () => void persist(defaultRightPanelPrefs())

  return (
    <div className="space-y-1">
      <SettingsPageHeader
        title="右侧栏"
        description="自定义主界面右侧 Tab：关闭后不再显示标签与面板内容；设置写入本机应用配置（electron-store）。"
        action={
          <button
            type="button"
            onClick={resetDefaults}
            disabled={saving}
            className="rounded-md border border-border/50 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            恢复默认
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border/40 bg-[var(--bg-1)]/50 px-3 py-2 text-[12px] text-muted-foreground">
        <LayoutPanelLeft className="h-4 w-4 shrink-0 opacity-60" />
        <span>已启用 {enabledCount} / {RIGHT_PANEL_IDS.length} 个栏目</span>
      </div>

      <ul className="divide-y divide-border/40 rounded-lg border border-border/40">
        {RIGHT_PANEL_CATALOG.map((item) => {
          const label = t(item.labelKey, { defaultValue: item.fallbackLabel })
          const on = prefs[item.id]
          const lastOne = on && enabledCount <= 1
          return (
            <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">{label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/70">{item.description}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/45">{item.id}</div>
              </div>
              <Toggle on={on} onChange={(v) => setOne(item.id, v)} disabled={saving || (lastOne && on)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}