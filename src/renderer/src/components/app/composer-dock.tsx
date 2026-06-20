import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * 底部悬浮输入区：Timeline 滚入底部留白；输入/指标在独立层，不透明底挡住背后文字。
 */
export function ComposerDock({ className, children }: { className?: string; children: ReactNode }) {
  const dockRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dock = dockRef.current
    const host = hostRef.current
    if (!dock || !host) return

    const sync = () => {
      host.style.setProperty('--composer-dock-h', `${dock.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(dock)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      host.style.removeProperty('--composer-dock-h')
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={cn('composer-dock-host pointer-events-none absolute inset-x-0 bottom-0 z-30', className)}
    >
      <div
        className="composer-dock-fade pointer-events-none absolute inset-x-0 bottom-0 h-[calc(var(--composer-dock-h,10rem)+1.25rem)]"
        aria-hidden
      />
      <div
        ref={dockRef}
        className="composer-dock-inner relative mx-auto w-full max-w-[var(--chat-content-max)] px-4 pb-3 pt-1 sm:px-6"
      >
        <div className="composer-dock-panel pointer-events-auto">{children}</div>
      </div>
    </div>
  )
}