import { ChevronLeft, Zap, Circle, FolderOpen, Plus, MessageSquare, Settings, Activity, GitBranch, ListTree, CircleDot, PanelLeft, PanelRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

interface TopBarProps {
  onBack?: () => void
  title?: string
  isRunning?: boolean
  projectName?: string
}

export function TopBar({ onBack, title, isRunning, projectName }: TopBarProps) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const showRightToggle = !onBack
  return (
    <div className="flex h-11 items-center justify-between border-b border-border/60 px-3">
      <div className="flex items-center gap-2.5">
        {!onBack && (
          <button
            onClick={toggleSidebar}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]"
          >
            <PanelLeft className={cn('h-3.5 w-3.5 transition-transform duration-motion-normal ease-motion-ease', collapsed && 'rotate-180')} />
          </button>
        )}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <CircleDot className="h-3.5 w-3.5 text-primary" />
          <span className="text-[13px] font-semibold tracking-tight">{title || 'pi Desktop'}</span>
        </div>
        {projectName && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-[13px] text-muted-foreground">{projectName}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isRunning ? (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/5 px-2 py-0.5">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[11px] font-medium text-green-600 dark:text-green-400">运行中</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-full bg-muted/50 px-2 py-0.5">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground">空闲</span>
          </div>
        )}
        {showRightToggle && (
          <button
            onClick={toggleRightPanel}
            title={rightCollapsed ? '展开右侧面板' : '收起右侧面板'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]"
          >
            <PanelRight className={cn('h-3.5 w-3.5 transition-transform duration-motion-normal ease-motion-ease', rightCollapsed && 'rotate-180')} />
          </button>
        )}
      </div>
    </div>
  )
}
