import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useRef, useState } from 'react'

interface SidebarProps {
  children: React.ReactNode
}

const COLLAPSED_WIDTH = 48

export function Sidebar({ children }: SidebarProps) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const width = useUIStore((s) => s.sidebarWidth)
  const setWidth = useUIStore((s) => s.setSidebarWidth)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      setWidth(e.clientX)
    }
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        setDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setWidth])

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width

  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col border-r border-border/60 overflow-hidden panel-width-animate',
        collapsed && 'sidebar-collapsed',
        dragging && 'panel-dragging',
      )}
      style={{
        background: 'var(--bg-1)',
        width: effectiveWidth,
      }}
    >
      <div className="sidebar-content-fade flex min-w-0 flex-1 flex-col">
        {children}
      </div>
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          className="absolute cursor-col-resize"
          style={{ width: 4, right: -2, top: 0, bottom: 0, zIndex: 20 }}
          aria-hidden
        />
      )}
    </aside>
  )
}

export function SidebarHeader({ label }: { label: string }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  if (collapsed) return null
  return (
    <div className="flex h-11 items-center border-b border-border/50 px-3">
      <span className="text-[13px] font-semibold text-foreground-secondary">{label}</span>
    </div>
  )
}

export function SidebarContent({ children }: SidebarContentProps) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  if (collapsed) {
    return <div className="flex flex-1 flex-col items-center gap-2 py-2">{children}</div>
  }
  return <div className="flex-1 overflow-y-auto py-1">{children}</div>
}

interface SidebarContentProps {
  children: React.ReactNode
}

interface SidebarItemProps {
  label: string
  active?: boolean
  onClick?: () => void
  icon?: React.ReactNode
}

export function RightPanel({ children }: { children: React.ReactNode }) {
  const width = useUIStore((s) => s.rightPanelWidth)
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const setWidth = useUIStore((s) => s.setRightPanelWidth)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      setWidth(window.innerWidth - e.clientX)
    }
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        setDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setWidth])

  const effectiveWidth = collapsed ? 44 : width

  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col border-l border-border/60 overflow-hidden panel-width-animate',
        collapsed && 'sidebar-collapsed',
        dragging && 'panel-dragging',
      )}
      style={{
        background: 'var(--bg-1)',
        width: effectiveWidth,
      }}
    >
      <div className="sidebar-content-fade flex min-w-0 flex-1 flex-col">
        {children}
      </div>
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          className="absolute cursor-col-resize"
          style={{ width: 4, left: -2, top: 0, bottom: 0, zIndex: 20 }}
          aria-hidden
        />
      )}
    </aside>
  )
}

export function SidebarItem({ label, active, onClick, icon }: SidebarItemProps) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  return (
    <div
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'nav-row sider-item-motion flex cursor-pointer items-center rounded-lg',
        collapsed ? 'mx-auto h-9 w-9 justify-center' : 'mx-1.5 gap-2.5 px-3 py-2 text-[14px] leading-6',
        active ? 'nav-row-active text-foreground font-medium' : 'text-foreground-secondary hover:text-foreground',
      )}
    >
      {icon}
      {!collapsed && <span className="sidebar-label-fade">{label}</span>}
    </div>
  )
}
