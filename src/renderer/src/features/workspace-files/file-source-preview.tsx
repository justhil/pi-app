import { useEffect, useMemo, useState } from 'react'
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
  readComplete: boolean
  /** Workspace-relative path for line refs into the composer */
  path?: string
  onRequestFullContent?: () => Promise<string | null>
}

/**
 * Workspace file code preview: full content (no auto-fold), Shiki highlight when possible.
 */
export function FileSourcePreview({
  code,
  lang,
  fill,
  readComplete,
  path,
  onRequestFullContent,
}: Props) {
  const [fullCode, setFullCode] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)

  const displayCode = fullCode ?? code
  const lines = useMemo(() => displayCode.split('\n'), [displayCode])
  const useShiki = displayCode.length <= PREVIEW_SHIKI_MAX_CHARS

  // New file content: drop any previous full-load cache.
  useEffect(() => {
    setFullCode(null)
    setHtml(null)
  }, [code])

  // Truncated first read: fetch full file once (still no fold UI).
  useEffect(() => {
    if (readComplete || !onRequestFullContent || fullCode != null) return
    let cancelled = false
    void onRequestFullContent().then((next) => {
      if (!cancelled && next != null) setFullCode(next)
    })
    return () => {
      cancelled = true
    }
  }, [readComplete, onRequestFullContent, fullCode, code])

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

  const lineCount = lines.length
  const gutterCh = Math.max(2, String(lineCount).length) + 2

  return (
    <div
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
            <div
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
            </div>
            <div className="min-w-0 shrink-0 py-2 pl-5 pr-4">
              {useShiki && html != null ? (
                <div
                  className="native-code-shiki font-mono text-[11px] leading-[1.5] text-foreground [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent [&_code]:text-[11px]"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
                />
              ) : (
                <pre className="m-0 whitespace-pre font-mono text-[11px] leading-[1.5] text-foreground">
                  {displayCode}
                </pre>
              )}
            </div>
          </div>
        </div>
      </OverlayScrollHost2D>
    </div>
  )
}
