import { useEffect, useState } from 'react'

/**
 * Suppresses non-essential panel transitions for two animation frames right after switching
 * sessions or workspaces, eliminating stale slide-in ghosts during fast navigation.
 */
export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedKey, setPaintedKey] = useState<string>(navigationKey)
  const suppressed = paintedKey !== navigationKey

  useEffect(() => {
    if (!suppressed) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPaintedKey(navigationKey)
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [navigationKey, suppressed])

  return suppressed
}
