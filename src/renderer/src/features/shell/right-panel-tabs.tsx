import { useEffect, useRef, useState } from 'react'
import { wheelToHorizontal } from '@renderer/lib/horizontal-wheel'
import { cn } from '@renderer/lib/utils'

/**
 * Panel tabs in one scrollable row. The mouse wheel scrolls the row sideways (only while the
 * pointer is over it), the active tab is kept in view, and faded edges show there is more.
 */
export function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
}: {
  panels: { key: string; label: string }[]
  activePanel: string
  setActivePanel: (p: string) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const update = () =>
      setEdges({ start: strip.scrollLeft > 1, end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 })
    // Non-passive: the wheel must not also scroll whatever is underneath.
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToHorizontal(e, strip)
      if (dx === null) return
      e.preventDefault()
      strip.scrollLeft += dx
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(strip)
    strip.addEventListener('scroll', update, { passive: true })
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      strip.removeEventListener('scroll', update)
      strip.removeEventListener('wheel', onWheel)
    }
  }, [panels.length])

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(activePanel)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activePanel])

  return (
    <div className="right-panel-tabs-wrap flex h-11 shrink-0 items-center border-b border-border/40 px-2">
      <div
        ref={stripRef}
        className={cn(
          'right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto',
          edges.start && 'right-panel-tabs-fade-start',
          edges.end && 'right-panel-tabs-fade-end',
        )}
        role="tablist"
      >
        {panels.map((panel) => {
          const active = activePanel === panel.key
          return (
            <button
              key={panel.key}
              type="button"
              role="tab"
              data-panel-tab={panel.key}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setActivePanel(panel.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const i = panels.findIndex((p) => p.key === panel.key)
                const next = panels[(i + (e.key === 'ArrowRight' ? 1 : panels.length - 1)) % panels.length]
                setActivePanel(next.key)
                stripRef.current?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(next.key)}"]`)?.focus()
              }}
              className={cn(
                'h-8 min-w-11 shrink-0 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors',
                active
                  ? 'bg-[var(--bg-active)] text-foreground'
                  : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              {panel.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
