import { useState } from 'react'
import { PanelRight, RefreshCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'
import { toast } from 'sonner'

/** 浮在对话区右上角，不占右栏单独一行 */
export function MainColRightPanelToggle() {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)
  const [reloading, setReloading] = useState(false)

  const onReload = async () => {
    if (reloading) return
    setReloading(true)
    try {
      const r = await reloadCurrentSessionData()
      if (r.ok) toast.success('已刷新会话数据')
      else toast.error(r.error || '刷新失败')
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
      <button
        type="button"
        onClick={toggle}
        title={collapsed ? '展开右侧面板' : '收起右侧面板'}
        className={btnBase}
        style={{ background: 'color-mix(in srgb, var(--surface-sidebar) 92%, transparent)' }}
      >
        <PanelRight
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
            collapsed && 'rotate-180',
          )}
        />
      </button>
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={reloading}
        title="刷新会话数据（与 CLI 同步）"
        className={cn(btnBase, 'transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground')}
        style={{ background: 'color-mix(in srgb, var(--surface-sidebar) 92%, transparent)' }}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
      </button>
    </div>
  )
}