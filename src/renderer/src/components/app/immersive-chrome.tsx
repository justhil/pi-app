import { PanelLeft, PanelRight, CircleDot } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

/** 无边框窗口顶栏：可拖拽区域 + 侧栏开关 + 运行状态（主对话页无厚重 TopBar） */
export function ImmersiveChrome({
  projectName,
  isRunning,
}: {
  projectName?: string
  isRunning?: boolean
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)

  return (
    <div
      className="electron-drag relative z-20 flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-2"
      style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, transparent)' }}
    >
      <div className="electron-no-drag flex items-center gap-1">
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary transition-all duration-[var(--motion-fast)] ease-[var(--motion-ease)] hover:bg-[var(--bg-hover)] hover:text-foreground active:scale-[0.94]"
        >
          <PanelLeft
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
              collapsed && 'rotate-180',
            )}
          />
        </button>
        <div className="flex items-center gap-1.5 px-1 text-[12px] text-foreground-secondary select-none">
          <CircleDot className="h-3 w-3 text-brand shrink-0" />
          <span className="font-medium text-foreground/90">pi</span>
          {projectName && (
            <>
              <span className="opacity-35">/</span>
              <span className="max-w-[200px] truncate">{projectName}</span>
            </>
          )}
        </div>
      </div>
      <div className="electron-no-drag flex items-center gap-2 pr-0.5">
        {isRunning ? (
          <div className="flex items-center gap-1.5 rounded-full px-2 py-0.5 animate-breathe" style={{ background: 'color-mix(in srgb, var(--brand) 12%, transparent)' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] font-medium text-green-600 dark:text-green-400">运行中</span>
          </div>
        ) : (
          <span className="text-[10px] text-foreground-secondary/70 tabular-nums">就绪</span>
        )}
        <button
          type="button"
          onClick={toggleRightPanel}
          title={rightCollapsed ? '展开右侧面板' : '收起右侧面板'}
          className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary transition-all duration-[var(--motion-fast)] ease-[var(--motion-ease)] hover:bg-[var(--bg-hover)] hover:text-foreground active:scale-[0.94]"
        >
          <PanelRight
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
              rightCollapsed && 'rotate-180',
            )}
          />
        </button>
      </div>
    </div>
  )
}