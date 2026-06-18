import { useState } from 'react'
import { cn } from '@renderer/lib/utils'

const TABS = ['Review', 'Trellis', 'Run'] as const
type Tab = (typeof TABS)[number]

export function PanelTabs() {
  const [active, setActive] = useState<Tab>('Review')

  return (
    <aside className="flex w-80 flex-col border-l border-border">
      <div className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={cn(
              'flex-1 px-3 py-2.5 text-xs font-medium transition-colors duration-motion-fast ease-motion-ease',
              active === tab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs text-muted-foreground">
          {active === 'Review' && '改动审查面板 - 待实现'}
          {active === 'Trellis' && 'Trellis 任务面板 - 待实现'}
          {active === 'Run' && '运行状态面板 - 待实现'}
        </div>
      </div>
    </aside>
  )
}
