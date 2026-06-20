import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'

export type SessionMenuTarget = {
  sessionId: string
  sessionFile?: string
  title: string
  workspacePath: string
}

type MenuState = { x: number; y: number; target: SessionMenuTarget } | null

export function useSessionContextMenu(onSessionsChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, target: SessionMenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onSessionsChange }
}

export function SessionContextMenuPortal({
  menu,
  onClose,
  onSessionsChange,
}: {
  menu: MenuState
  onClose: () => void
  onSessionsChange: () => void
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

  const { target } = menu
  const defaultTitle = target.title || target.sessionId.slice(0, 8)

  const refreshList = async () => {
    const wid = target.workspacePath || useUIStore.getState().currentWorkspace
    if (!wid) return
    const listRes = await ipcClient.invoke('session.list', { workspaceId: wid })
    if (wid === useUIStore.getState().currentWorkspace) {
      useUIStore.getState().setSessions(listRes?.sessions || [])
    }
    onSessionsChange()
  }

  const runRename = async () => {
    const next = window.prompt('重命名会话', defaultTitle)
    if (next == null) {
      onClose()
      return
    }
    const title = next.trim()
    if (!title) {
      toast.error('名称不能为空')
      onClose()
      return
    }
    if (!target.sessionFile) {
      toast.error('无法重命名：缺少会话文件路径')
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('session.rename', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
        title,
      })
      if (r?.ok) {
        toast.success('已重命名')
        await refreshList()
      } else toast.error(r?.error || '重命名失败')
    } catch {
      toast.error('重命名失败')
    }
    onClose()
  }

  const runDelete = async () => {
    if (!target.sessionFile) {
      toast.error('无法删除：缺少会话文件路径')
      onClose()
      return
    }
    if (!window.confirm(`删除会话「${defaultTitle}」？对应的 pi 会话文件将永久删除。`)) {
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('session.delete', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
      })
      if (r?.ok) {
        const cur = useUIStore.getState().currentSessionId
        if (cur === target.sessionId) {
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().clearTimeline()
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
          void ipcClient.invoke('session.setPendingBind', { sessionFile: null })
        }
        toast.success('已删除')
        await refreshList()
      } else toast.error(r?.error || '删除失败')
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