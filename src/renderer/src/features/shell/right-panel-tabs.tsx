import { useCallback, useEffect, useRef, useState, type ComponentType, type WheelEvent } from 'react'
import { cn } from '@renderer/lib/utils'
import type { RightPanelId } from '@shared/right-panels'

export function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
}: {
  panels: { key: string; label: string; icon: ComponentType<{ className?: string }> }[]
  activePanel: string
  setActivePanel: (p: RightPanelId) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [thumb, setThumb] = useState<{ leftPct: number; widthPct: number; scrollable: boolean }>({
    leftPct: 0,
    widthPct: 0,
    scrollable: false,
  })

  const updateThumb = useCallback(() => {
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) {
      setThumb({ leftPct: 0, widthPct: 0, scrollable: false })
      return
    }
    const widthPct = (el.clientWidth / el.scrollWidth) * 100
    const maxLeft = 100 - widthPct
    const scrollMax = el.scrollWidth - el.clientWidth
    const leftPct = scrollMax > 0 ? (el.scrollLeft / scrollMax) * maxLeft : 0
    setThumb({ leftPct, widthPct, scrollable: true })
  }, [])

  useEffect(() => {
    updateThumb()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateThumb())
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateThumb, panels.length])

  const onTabsWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += e.deltaY
    updateThumb()
  }

  const showRail = hover && thumb.scrollable

  return (
    <div
      className="right-panel-tabs-wrap shrink-0 border-b border-border/50"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        ref={scrollRef}
        className="right-panel-tabs-scroll overflow-x-auto overflow-y-hidden"
        onWheel={onTabsWheel}
        onScroll={updateThumb}
        role="tablist"
      >
        <div className="flex w-max min-w-full items-stretch">
          {panels.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={activePanel === p.key}
              onClick={() => setActivePanel(p.key as RightPanelId)}
              className={cn(
                'row-hover flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-md transition-colors duration-200',
                activePanel === p.key
                  ? 'bg-[var(--bg-active)] text-foreground'
                  : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              <p.icon className="h-3 w-3 shrink-0" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[3px] w-full" aria-hidden>
        <div
          className={cn(
            'pointer-events-none absolute top-0 h-[3px] max-h-[3px] rounded-full bg-[rgba(127,127,127,0.38)] transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            showRail ? 'opacity-100' : 'opacity-0',
          )}
          style={{ left: `${thumb.leftPct}%`, width: `${thumb.widthPct}%` }}
        />
      </div>
    </div>
  )
}