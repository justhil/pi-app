import { cn } from '@renderer/lib/utils'

interface SidebarProps {
  children: React.ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border/80 bg-muted/20">
      {children}
    </aside>
  )
}

export function SidebarHeader({ label }: { label: string }) {
  return (
    <div className="flex h-12 items-center border-b border-border/80 px-3">
      <span className="text-[13px] font-semibold">{label}</span>
    </div>
  )
}

export function SidebarContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto py-1">{children}</div>
}

interface SidebarItemProps {
  label: string
  active?: boolean
  onClick?: () => void
  icon?: React.ReactNode
}

export function SidebarItem({ label, active, onClick, icon }: SidebarItemProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'mx-2 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-all duration-motion-fast ease-motion-ease',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </div>
  )
}
