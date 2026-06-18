import { cn } from '@renderer/lib/utils'

interface SidebarProps {
  children: React.ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="flex w-56 flex-col border-r border-border bg-muted/30">
      {children}
    </aside>
  )
}

export function SidebarHeader({ label }: { label: string }) {
  return (
    <div className="flex h-12 items-center border-b border-border px-3">
      <span className="text-sm font-semibold">{label}</span>
    </div>
  )
}

export function SidebarContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto py-2">{children}</div>
}

export function SidebarItem({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={cn(
        'mx-2 flex cursor-pointer items-center rounded-md px-3 py-2 text-sm transition-colors duration-motion-fast ease-motion-ease',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {label}
    </div>
  )
}
