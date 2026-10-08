import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { OverlayScrollHost2D } from '@renderer/components/ui/overlay-scrollbar'
import { highlightCodeToHtml } from '@renderer/lib/shiki-highlighter'
import { LineGutterAddButton } from '@renderer/components/ui/line-gutter-add'
import { PREVIEW_SHIKI_MAX_CHARS } from './file-preview-limits'

type Props = {
  code: string
  lang?: string
  fill?: boolean
  /** Workspace-relative path for line refs into the composer */
  path?: string
  sourceLocation?: { line: number } | null
}

/**
 * Workspace file code preview: full content (no auto-fold), Shiki highlight when possible.
 */
export function FileSourcePreview({
  code,
  lang,
  fill,
  path,
  sourceLocation,
}: Props) {
  const previewRef = useRef<HTMLDivElement>(null)
  const plainLineRef = useRef<HTMLSpanElement>(null)
  const [html, setHtml] = useState<string | null>(null)

  const displayCode = code
  const useShiki = displayCode.length <= PREVIEW_SHIKI_MAX_CHARS
  const hasLocation = !!sourceLocation
  const lines = useMemo(() => useShiki || hasLocation ? displayCode.split('\n') : [], [displayCode, useShiki, hasLocation])
  const targetLine = sourceLocation && sourceLocation.line > 0 && sourceLocation.line <= lines.length ? sourceLocation.line : null

  useEffect(() => {
    setHtml(null)
  }, [code])

  useEffect(() => {
    if (!useShiki) {
      setHtml(null)
      return
    }
    let cancelled = false
    highlightCodeToHtml(displayCode, lang).then((highlighted) => {
      if (!cancelled) setHtml(highlighted)
    })
    return () => {
      cancelled = true
    }
  }, [displayCode, lang, useShiki])

  useEffect(() => {
    if (!targetLine) return
    const target = previewRef.current?.querySelectorAll('.native-code-shiki .line')[targetLine - 1]
      ?? plainLineRef.current
    if (!target) return
    target.setAttribute('data-source-line', String(targetLine))
    target.classList.add('bg-accent/15')
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    return () => {
      target.removeAttribute('data-source-line')
      target.classList.remove('bg-accent/15')
    }
  }, [html, displayCode, sourceLocation, targetLine])

  const lineCount = lines.length
  const gutterCh = Math.max(2, String(lineCount).length) + 2

  return (
    <div
      ref={previewRef}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--code-bg)]',
        !fill && 'border border-border/50',
      )}
    >
      <OverlayScrollHost2D
        className={cn('files-preview-scroll-host min-h-0 flex-1', fill && 'h-full')}
        scrollClassName="min-h-full"
        showRailOnHostHover
      >
        <div className="inline-block min-h-min min-w-full align-top">
          <div className="flex min-w-max font-mono text-[11px] leading-[1.5]">
            {useShiki && <div
              className="sticky left-0 z-[2] shrink-0 select-none border-r border-border/50 bg-[var(--bg-2)] py-2 pl-1 pr-2 text-right text-foreground-secondary/70"
              style={{ minWidth: `${gutterCh + 2}ch` }}
              aria-hidden
            >
              {lines.map((lineText, lineIndex) => (
                <div
                  key={lineIndex}
                  className="group/line flex h-[1.5em] items-center justify-end gap-0.5 tabular-nums"
                >
                  {path ? (
                    <LineGutterAddButton path={path} line={lineIndex + 1} content={lineText} />
                  ) : (
                    <span className="w-[1.15em]" />
                  )}
                  <span className="w-[2.5ch] text-right">{lineIndex + 1}</span>
                </div>
              ))}
            </div>}
            <div className="min-w-0 shrink-0 py-2 pl-5 pr-4">
              {useShiki && html != null && (!targetLine || html.includes('class="line"')) ? (
                <div
                  className="native-code-shiki font-mono text-[11px] leading-[1.5] text-foreground [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent [&_code]:text-[11px]"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
                />
              ) : (
                <pre className="m-0 whitespace-pre font-mono text-[11px] leading-[1.5] text-foreground">
                  {targetLine ? <>
                    {targetLine > 1 ? lines.slice(0, targetLine - 1).join('\n') + '\n' : ''}
                    <span ref={plainLineRef} data-source-line={targetLine}>{lines[targetLine - 1]}</span>
                    {targetLine < lines.length ? '\n' + lines.slice(targetLine).join('\n') : ''}
                  </> : displayCode}
                </pre>
              )}
            </div>
          </div>
        </div>
      </OverlayScrollHost2D>
    </div>
  )
}
