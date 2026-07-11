import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { OverlayScrollHost2D } from '@renderer/components/ui/overlay-scrollbar'
import { highlightCodeToHtml } from '@renderer/lib/shiki-highlighter'
import { LineGutterAddButton } from '@renderer/components/ui/line-gutter-add'
import { PREVIEW_SHIKI_MAX_CHARS } from './file-preview-limits'

const FOLD_LINES = 48

type Props = {
  code: string
  lang?: string
  fill?: boolean
  readComplete: boolean
  /** Workspace-relative path for line refs into the composer */
  path?: string
  onRequestFullContent?: () => Promise<string | null>
}

export function FileSourcePreview({
  code,
  lang,
  fill,
  readComplete,
  path,
  onRequestFullContent,
}: Props) {
  const { t } = useTranslation('files')
  const [expanded, setExpanded] = useState(false)
  const [fullCode, setFullCode] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [html, setHtml] = useState<string | null>(null)

  const displayCode = fullCode ?? code
  const lines = useMemo(() => displayCode.split('\n'), [displayCode])

  useEffect(() => {
    setExpanded(false)
    setFullCode(null)
  }, [code])

  const needsFold = lines.length > FOLD_LINES
  const visibleLines = expanded || !needsFold ? lines : lines.slice(0, FOLD_LINES)
  const visibleText = visibleLines.join('\n')
  const useShiki = visibleText.length <= PREVIEW_SHIKI_MAX_CHARS

  useEffect(() => {
    if (!useShiki) {
      setHtml(null)
      return
    }
    let cancelled = false
    highlightCodeToHtml(visibleText, lang).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [visibleText, lang, useShiki])

  const onExpand = async () => {
    if (!expanded && !readComplete && !fullCode && onRequestFullContent) {
      setLoadingFull(true)
      const next = await onRequestFullContent()
      setLoadingFull(false)
      if (next != null) setFullCode(next)
    }
    setExpanded(true)
  }

  const lineCount = visibleLines.length
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
              {visibleLines.map((lineText, i) => (
                <div key={i} className="group/line flex h-[1.5em] items-center justify-end gap-0.5 tabular-nums">
                  {path ? (
                    <LineGutterAddButton path={path} line={i + 1} content={lineText} />
                  ) : (
                    <span className="w-[1.15em]" />
                  )}
                  <span className="w-[2.5ch] text-right">{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="min-w-0 shrink-0 py-2 pl-5 pr-4">
              {useShiki && html != null ? (
                <div
                  className="native-code-shiki [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-[11px] [&_pre]:whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
                />
              ) : (
                <pre className="m-0 whitespace-pre text-foreground">{visibleText}</pre>
              )}
            </div>
          </div>
        </div>
      </OverlayScrollHost2D>
      {needsFold && !expanded ? (
        <button
          type="button"
          disabled={loadingFull}
          onClick={() => void onExpand()}
          className="flex w-full shrink-0 items-center justify-center gap-1 border-t border-border/40 py-2 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          {loadingFull ? t('preview.loading') : t('preview.expandAll', { count: lines.length })}
        </button>
      ) : null}
      {needsFold && expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full shrink-0 items-center justify-center gap-1 border-t border-border/40 py-1.5 text-[10px] text-foreground-secondary hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3 rotate-180" />
          {t('preview.collapse')}
        </button>
      ) : null}
    </div>
  )
}