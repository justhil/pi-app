import { PanelRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

/** 右栏本地顶栏：紧贴全局 ImmersiveChrome 下方，仅负责收起/展开 */
export function RightPanelChrome() {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)

  return (
    <div
      className={cn(
        'electron-no-drag flex h-9 shrink-0 items-center border-b border-border/50',
        collapsed ? 'justify-center px-1' : 'justify-end px-2',
      )}
      style={{ background: 'color-mix(in srgb, var(--bg-base) 88%, var(--bg-1))' }}
    >
      <button
        type="button"
        onClick={toggle}
        title={collapsed ? '展开右侧面板' : '收起右侧面板'}
        className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary"
      >
        <PanelRight
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
            collapsed && 'rotate-180',
          )}
        />
      </button>
    </div>
  )
}