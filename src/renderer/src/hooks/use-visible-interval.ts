import { useEffect, useRef } from 'react'

/**
 * Poll while the window is visible: run now, then every `intervalMs`; pause while hidden and
 * run once as soon as the window is shown again. Hidden windows have no one to show results to,
 * so they should not keep main busy with status IPC.
 */
export function useVisibleInterval(callback: () => void, intervalMs: number): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      callbackRef.current()
    }
    run()
    const timer = window.setInterval(run, intervalMs)
    const onVisibility = () => {
      if (!document.hidden) callbackRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
