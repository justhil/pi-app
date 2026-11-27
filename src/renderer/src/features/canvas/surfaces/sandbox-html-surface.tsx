import { useEffect, useMemo, useState } from 'react'
import type { CanvasHtmlPayload, CanvasSurface } from '@shared/canvas-types'
import { useCanvasStore } from '../canvas-store'

function buildThemeCssVars(): string {
  if (typeof document === 'undefined') return ''
  const style = getComputedStyle(document.documentElement)
  const keys = [
    '--bg-base',
    '--bg-1',
    '--bg-2',
    '--bg-hover',
    '--border-base',
    '--text-primary',
    '--text-secondary',
    '--brand',
    '--success-semantic',
    '--warning-semantic',
    '--danger-semantic',
    '--font-sans',
    '--font-mono',
  ]
  const pairs = keys
    .map((key) => {
      const value = style.getPropertyValue(key).trim()
      return value ? `${key}: ${value};` : ''
    })
    .filter(Boolean)
  const dark = document.documentElement.classList.contains('dark')
  return `:root { color-scheme: ${dark ? 'dark' : 'light'}; ${pairs.join(' ')} }`
}

export function SandboxHtmlSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasHtmlPayload
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [themeNonce, setThemeNonce] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeNonce((n) => n + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string; detail?: unknown } | null
      if (!data || data.source !== 'pi-canvas-sandbox') return
      const summary = `${data.type ?? 'event'}: ${JSON.stringify(data.detail ?? {})}`
      setLastEvent(summary)
      recordInteraction(surface.id, { lastSandboxEvent: { type: data.type, detail: data.detail } })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [recordInteraction, surface.id])

  const srcDoc = useMemo(() => {
    void themeNonce
    const vars = buildThemeCssVars()
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:;" />
<style>
${vars}
* { box-sizing: border-box; }
${payload.css ?? ''}
</style>
</head>
<body>${payload.html ?? ''}</body>
</html>`
  }, [payload.css, payload.html, themeNonce])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <iframe
        title={payload.title || surface.title}
        sandbox={payload.allowScripts === false ? '' : 'allow-scripts'}
        srcDoc={srcDoc}
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
      />
      {lastEvent ? (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/25 bg-[var(--bg-1)]/45 px-3 text-[10.5px] text-foreground-secondary">
          <span className="truncate font-mono">{lastEvent}</span>
        </div>
      ) : null}
    </div>
  )
}
