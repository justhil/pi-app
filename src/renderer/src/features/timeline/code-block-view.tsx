import { memo, useEffect, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
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
    <div
      className={cn('group overflow-hidden rounded-md border border-border/35', className)}
      style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}
    >
      <div
        className="flex items-center justify-between border-b border-border/30 px-2 py-0.5"
        style={{ background: 'color-mix(in srgb, var(--bg-3) 28%, transparent)' }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wide text-foreground-secondary/55">
          {lang || t('timeline:code')}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t('timeline:copied') : t('timeline:copy')}
          title={copied ? t('timeline:copied') : t('timeline:copy')}
          className="flex h-5 w-5 items-center justify-center rounded text-foreground-secondary/50 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <div
        className={cn(
          'native-code-shiki overflow-auto text-[11px] leading-[1.45]',
          expanded ? maxHeightExpanded : 'max-h-40',
        )}
      >
        {html != null ? (
          <div
            className="p-2 [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-[11px]"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        ) : (
          <pre className="p-2 font-mono text-foreground-secondary whitespace-pre-wrap break-all">
            {code.slice(0, 2000)}
          </pre>
        )}
      </div>
      {needsFold && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? t('timeline:collapse') : t('timeline:expand', { count: lines.length })}
          title={expanded ? t('timeline:collapse') : t('timeline:expand', { count: lines.length })}
          className="flex w-full items-center justify-center border-t border-border/30 py-0.5 text-foreground-secondary/45 hover:text-foreground-secondary"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}

export const CodeBlockView = memo(CodeBlockViewImpl)
