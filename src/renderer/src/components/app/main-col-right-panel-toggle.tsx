import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRight, RefreshCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'
import { toast } from 'sonner'

/**
 * 浮在对话区右上角。
 * Cursor UI 实验：右栏收起时由窄轨承担展开入口，此处只保留「刷新」；展开时仍显示收起按钮。
 */
export function MainColRightPanelToggle() {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)
  const [reloading, setReloading] = useState(false)

  const onReload = async () => {
    if (reloading) return
    setReloading(true)
    try {
      const r = await reloadCurrentSessionData()
      if (r.ok) toast.success(t('common:sessionReload.success'))
      else toast.error(r.error || t('common:sessionReload.failed'))
    } finally {
      setReloading(false)
    }
  }

  const btnBase =
    'electron-no-drag chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md border border-border/50 shadow-sm text-foreground-secondary disabled:opacity-50'

  return (
    <div
      className="absolute right-3 top-2 z-20 flex flex-col gap-1"
      style={{ background: 'transparent' }}
    >
      {!collapsed && (
        <button
          type="button"
          onClick={toggle}
          title={t('common:topbar.collapseRightPanel')}
          className={btnBase}
          style={{ background: 'color-mix(in srgb, var(--surface-sidebar) 92%, transparent)' }}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={reloading}
        title={t('common:sessionReload.title')}
        className={cn(btnBase, 'transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground')}
        style={{ background: 'color-mix(in srgb, var(--surface-sidebar) 92%, transparent)' }}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
      </button>
    </div>
  )
}
