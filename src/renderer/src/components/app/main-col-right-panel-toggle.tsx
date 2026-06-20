import { PanelRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

/** 浮在对话区右上角，不占右栏单独一行 */
export function MainColRightPanelToggle() {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? '展开右侧面板' : '收起右侧面板'}
      className={cn(
        'electron-no-drag chrome-icon-btn absolute right-3 top-2 z-20',
        'flex h-7 w-7 items-center justify-center rounded-md border border-border/50 shadow-sm',
        'text-foreground-secondary',
      )}
      style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, transparent)' }}
    >
      <PanelRight
        className={cn(
          'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
          collapsed && 'rotate-180',
        )}
      />
    </button>
  )
}