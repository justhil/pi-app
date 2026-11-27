import { useMemo } from 'react'
import type { CanvasDiagramPayload, CanvasMarkdownPayload, CanvasSurface, CanvasUiBlockPayload } from '@shared/canvas-types'
import { UIBlockHost } from '@renderer/features/ui-blocks/host'
import { MermaidBlock } from '@renderer/features/timeline/mermaid-block'
import { sanitizeHtml } from '@renderer/lib/sanitize'

export function UiBlockSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasUiBlockPayload
  const raw = useMemo(
    () =>
      JSON.stringify({
        component: payload.component,
        id: surface.id,
        props: payload.props ?? {},
      }),
    [payload.component, payload.props, surface.id],
  )
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg-base)] p-3.5">
      {payload.caption ? (
        <p className="mb-2.5 text-[11.5px] leading-relaxed text-foreground-secondary">{payload.caption}</p>
      ) : null}
      <UIBlockHost raw={raw} streaming={false} />
    </div>
  )
}

export function DiagramSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDiagramPayload
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--bg-base)] p-3.5">
      {payload.caption ? (
        <p className="mb-2 text-[11.5px] leading-relaxed text-foreground-secondary">{payload.caption}</p>
      ) : null}
      {payload.format === 'svg' ? (
        <div
          className="flex min-h-[240px] flex-1 items-center justify-center overflow-auto rounded-lg border border-border/40 bg-[var(--bg-1)]/50 p-3"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(payload.code) }}
        />
      ) : (
        <MermaidBlock code={payload.code} streaming={false} />
      )}
    </div>
  )
}

export function MarkdownSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasMarkdownPayload
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--bg-base)] p-4">
      <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground">
        {payload.markdown}
      </pre>
    </div>
  )
}
