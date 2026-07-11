import { useEffect, useRef, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { composerTextEmpty } from './composer-text-empty'

export { composerTextEmpty, isRichInputElementEmpty } from './composer-text-empty'

/**
 * Empty composer double-Esc:
 * - doubleEscapeAction=tree → open session tree (TUI /tree)
 * - doubleEscapeAction=fork → open fork selector (TUI /fork)
 * - none → no-op
 */
export function useDoubleEscapeTree(enabled: boolean) {
  const [treeOpen, setTreeOpen] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)
  const lastEscRef = useRef(0)
  const actionRef = useRef<'tree' | 'fork' | 'none'>('tree')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ipcClient
      .invoke('pi.settings.get')
      .then((res) => {
        if (cancelled) return
        const a = String(res?.settings?.doubleEscapeAction || 'tree')
        if (a === 'tree' || a === 'fork' || a === 'none') actionRef.current = a
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (actionRef.current === 'none') return
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-tree-overlay]') || t?.closest('[data-fork-overlay]')) return

      const now = Date.now()
      const gap = now - lastEscRef.current
      lastEscRef.current = now

      if (gap > 500 || gap < 40) return
      if (!composerTextEmpty()) return

      if (actionRef.current === 'fork') {
        e.preventDefault()
        setTreeOpen(false)
        setForkOpen(true)
        return
      }
      if (actionRef.current === 'tree') {
        e.preventDefault()
        setForkOpen(false)
        setTreeOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])

  return {
    treeOpen,
    setTreeOpen,
    forkOpen,
    setForkOpen,
    openTree: () => setTreeOpen(true),
    openFork: () => setForkOpen(true),
  }
}
