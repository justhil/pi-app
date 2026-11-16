import { useEffect, useState } from 'react'
import { onActiveCodeThemeChange } from './render-fx-engine'

/**
 * Increments whenever either `.dark` mode toggles or the active structured theme changes `codeTheme`,
 * so mounted code blocks re-run Shiki immediately without a page reload.
 */
export function useCodeHighlightRevision(): number {
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const bump = () => setRev((n) => n + 1)
    const unsub = onActiveCodeThemeChange(bump)
    let obs: MutationObserver | null = null
    if (typeof document !== 'undefined') {
      obs = new MutationObserver(bump)
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
    }
    return () => {
      unsub()
      obs?.disconnect()
    }
  }, [])

  return rev
}
