import { useState } from 'react'
import { ChevronRight, ListTree, Loader2, XCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow, summarizeToolGroup } from './tool-call-row'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'

export function ToolGroupSummary({ tools }: { tools: any[] }) {
  const [expanded, setExpanded] = useState(false)
  const { label, running, hasError } = summarizeToolGroup(tools)

  return (
    <div className="ui-enter py-0.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group row-hover flex w-full items-center gap-2 rounded-lg border border-border/35 px-2.5 py-1.5 text-left"
        style={{ background: 'color-mix(in srgb, var(--bg-2) 80%, transparent)' }}
      >
        <ChevronRight
          className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary"
          data-open={expanded ? 'true' : 'false'}
        />
        <ListTree className="h-3.5 w-3.5 shrink-0 text-aou-6" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-secondary group-hover:text-foreground">
          {label}
        </span>
        {running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-aou-5" />}
        {!running && hasError && <XCircle className="h-3 w-3 shrink-0 text-destructive/70" />}
      </button>
      <CollapsiblePanel open={expanded} className="mt-1">
        <div className="space-y-0.5 rounded-lg border border-border/30 px-1 py-1" style={{ background: 'var(--bg-1)' }}>
          {tools.map((t, i) => (
            <div key={t.id} className={cn('ui-enter', i < 5 && `stagger-${i + 1}`)}>
              <ToolCallRow item={t} compact />
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </div>
  )
}