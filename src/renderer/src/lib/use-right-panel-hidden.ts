import { useEffect, useState } from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { currentWindowWidth, isRightPanelHidden } from '@renderer/lib/right-panel-visibility'

export function useRightPanelHidden(): boolean {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const expandedOnNarrow = useUIStore((s) => s.rightPanelExpandedOnNarrow)
  const [windowWidth, setWindowWidth] = useState(currentWindowWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isRightPanelHidden({ collapsed, expandedOnNarrow, windowWidth })
}
