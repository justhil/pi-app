import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'

type MenuState = { x: number; y: number; path: string; label: string } | null

export function useSandboxContextMenu(onListChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, path: string, label: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path, label })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}

export function SandboxContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null

  const runRename = async () => {
    const next = window.prompt('重命名临时对话', menu.label)
    if (next == null) {
      onClose()
      return
    }
    const label = next.trim()
    if (!label) {
      toast.error('名称不能为空')
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('workspace.sandbox.rename', { path: menu.path, label })
      if (r?.ok) {
        toast.success('已重命名')
        onListChange()
      } else toast.error('重命名失败')
    } catch {
      toast.error('重命名失败')
    }
    onClose()
  }

  const runDelete = async () => {
    if (!window.confirm(`删除「${menu.label}」？目录与 pi 会话将一并移除。`)) {
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('workspace.sandbox.delete', { path: menu.path })
      if (r?.ok) {
        const cur = useUIStore.getState().currentWorkspace
        if (cur === menu.path) {
          useUIStore.getState().setWorkspace(null)
          useUIStore.getState().clearTimeline()
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
        }
        toast.success('已删除')
        onListChange()
      } else toast.error('删除失败')
    } catch {
      toast.error('删除失败')
    }
    onClose()
  }

  const itemClass =
    'w-full cursor-pointer px-3 py-2 text-left text-[13px] text-foreground hover:bg-[var(--bg-hover)]'

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] min-w-[140px] overflow-hidden rounded-lg border border-border bg-[var(--bg-2)] py-1 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
    >
      <button type="button" className={itemClass} onClick={() => void runRename()}>
        重命名
      </button>
      <button
        type="button"
        className={`${itemClass} text-red-600 dark:text-red-400`}
        onClick={() => void runDelete()}
      >
        删除
      </button>
    </div>,
    document.body,
  )
}