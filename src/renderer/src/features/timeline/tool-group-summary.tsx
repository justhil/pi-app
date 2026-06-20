import { useState } from 'react'
import { ChevronRight, ListTree, Loader2, XCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ToolCallRow, summarizeToolGroup } from './tool-call-row'

export function ToolGroupSummary({ tools }: { tools: any[] }) {
  const [expanded, setExpanded] = useState(false)
  const { label, running, hasError } = summarizeToolGroup(tools)

  return (
    <div className="py-0.5 animate-in fade-in slide-in-from-bottom-1 duration-[var(--motion-normal)] ease-[var(--motion-ease)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group row-hover flex w-full items-center gap-2 rounded-lg border border-border/35 px-2.5 py-1.5 text-left"
        style={{ background: 'color-mix(in srgb, var(--bg-2) 80%, transparent)' }}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-foreground-secondary transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
            expanded && 'rotate-90',
          )}
        />
        <ListTree className="h-3.5 w-3.5 shrink-0 text-aou-6" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-secondary group-hover:text-foreground">
          {label}
        </span>
        {running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-aou-5" />}
        {!running && hasError && <XCircle className="h-3 w-3 shrink-0 text-destructive/70" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 rounded-lg border border-border/30 px-1 py-1" style={{ background: 'var(--bg-1)' }}>
          {tools.map((t) => (
            <ToolCallRow key={t.id} item={t} compact />
          ))}
        </div>
      )}
    </div>
  )
}