import { useEffect, useRef, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'

function composerTextEmpty(): boolean {
  const el = document.querySelector('[data-composer-root] textarea') as HTMLTextAreaElement | null
  if (!el) return true
  return !el.value.trim()
}

/** 空输入框双击 Esc → 打开会话树卡片（对齐 pi doubleEscapeAction=tree） */
export function useDoubleEscapeTree(enabled: boolean) {
  const [treeOpen, setTreeOpen] = useState(false)
  const lastEscRef = useRef(0)
  const actionRef = useRef<'tree' | 'fork' | 'none'>('tree')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ipcClient.invoke('pi.settings.get').then((res) => {
      if (cancelled) return
      const a = String(res?.settings?.doubleEscapeAction || 'tree')
      if (a === 'tree' || a === 'fork' || a === 'none') actionRef.current = a
    }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (actionRef.current === 'none') return
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-tree-overlay]')) return

      const now = Date.now()
      const gap = now - lastEscRef.current
      lastEscRef.current = now

      if (gap > 450 || gap < 40) return
      if (!composerTextEmpty()) return

      if (actionRef.current === 'fork') {
        e.preventDefault()
        return
      }
      if (actionRef.current === 'tree') {
        e.preventDefault()
        setTreeOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])

  return { treeOpen, setTreeOpen, openTree: () => setTreeOpen(true) }
}