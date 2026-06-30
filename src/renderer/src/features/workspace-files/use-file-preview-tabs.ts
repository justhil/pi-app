import { useCallback, useMemo, useState } from 'react'

export type PreviewTab = {
  id: string
  rel: string
  name: string
}

let tabSeq = 0
function nextTabId() {
  tabSeq += 1
  return `ft-${tabSeq}`
}

export function useFilePreviewTabs() {
  const [tabs, setTabs] = useState<PreviewTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])

  const openFile = useCallback((rel: string, name: string, mode: 'replace' | 'new-tab') => {
    setTabs((prev) => {
      if (mode === 'new-tab') {
        const hit = prev.find((t) => t.rel === rel)
        if (hit) {
          setActiveId(hit.id)
          return prev
        }
        const id = nextTabId()
        setActiveId(id)
        return [...prev, { id, rel, name }]
      }

      if (prev.length === 0) {
        const id = nextTabId()
        setActiveId(id)
        return [{ id, rel, name }]
      }

      if (prev.length === 1) {
        setActiveId(prev[0].id)
        return [{ ...prev[0], rel, name }]
      }

      const aid = activeId ?? prev[0]?.id ?? null
      if (aid) setActiveId(aid)
      return prev.map((t) => (t.id === aid ? { ...t, rel, name } : t))
    })
  }, [activeId])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx < 0) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) {
        const neighbor = next[Math.min(idx, next.length - 1)]
        setActiveId(neighbor?.id ?? null)
      }
      return next
    })
  }, [activeId])

  const activateTab = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const reorderTabs = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId)
      const to = prev.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const renameTabRel = useCallback((oldRel: string, newRel: string, newName: string) => {
    setTabs((prev) => prev.map((t) => (t.rel === oldRel ? { ...t, rel: newRel, name: newName } : t)))
  }, [])

  const resetTabs = useCallback(() => {
    setTabs([])
    setActiveId(null)
  }, [])

  return {
    tabs,
    activeId,
    activeTab,
    openFile,
    closeTab,
    activateTab,
    reorderTabs,
    renameTabRel,
    resetTabs,
  }
}