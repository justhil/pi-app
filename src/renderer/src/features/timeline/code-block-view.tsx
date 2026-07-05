import { memo, useEffect, useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { highlightCodeToHtml } from '@renderer/lib/shiki-highlighter'

type Props = {
  code: string
  lang?: string
  /** 折叠时最多显示行数 */
  previewLines?: number
  maxHeightExpanded?: string
  className?: string
  defaultExpanded?: boolean
}

function CodeBlockViewImpl({
  code,
  lang,
  previewLines = 8,
  maxHeightExpanded = 'max-h-72',
  className,
  defaultExpanded = false,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const lines = code.split('\n')
  const needsFold = lines.length > previewLines

  useEffect(() => {
    let cancelled = false
    const slice = expanded || !needsFold ? code : lines.slice(0, previewLines).join('\n')
    highlightCodeToHtml(slice, lang).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang, expanded, needsFold, previewLines])

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn('overflow-hidden rounded-md border border-border/50', className)} style={{ background: 'var(--bg-2)' }}>
      <div className="flex items-center justify-between border-b border-border/40 px-2 py-1">
        {lang ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--brand)]">{lang}</span>
        ) : (
          <span className="text-[10px] text-foreground-secondary">{t('timeline:code')}</span>
        )}
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-foreground-secondary hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          {copied ? t('timeline:copied') : t('timeline:copy')}
        </button>
      </div>
      <div
        className={cn('native-code-shiki overflow-auto text-[11px] leading-[1.45]', expanded ? maxHeightExpanded : 'max-h-48')}
      >
        {html != null ? (
          <div className="p-2 [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-[11px]" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
        ) : (
          <pre className="p-2 font-mono text-foreground-secondary whitespace-pre-wrap break-all">{code.slice(0, 2000)}</pre>
        )}
      </div>
      {needsFold && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-border/40 py-1.5 text-[10px] text-foreground-secondary hover:text-foreground"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? t('timeline:collapse') : t('timeline:expand', { count: lines.length })}
        </button>
      )}
    </div>
  )
}

export const CodeBlockView = memo(CodeBlockViewImpl)