import { cn } from '@renderer/lib/utils'

export function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
}: {
  panels: { key: string; label: string }[]
  activePanel: string
  setActivePanel: (p: string) => void
}) {
  return (
    <div className="right-panel-tabs-wrap flex h-11 shrink-0 items-center border-b border-border/40 px-2">
      <div className="right-panel-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
        {panels.map((panel) => {
          const active = activePanel === panel.key
          return (
            <button
              key={panel.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActivePanel(panel.key)}
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
