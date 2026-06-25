// Markdown renderer for assistant messages (参考桌面客户端-inspired).
// react-markdown + remark-gfm + remark-math/rehype-katex + 自定义 code/img/table 组件。
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'katex/contrib/mhchem/mhchem.js'
import { cn } from '@renderer/lib/utils'
import { preprocessMarkdownMath, KATEX_MACROS } from '@renderer/features/timeline/markdown-math-preprocess'
import { FencedMathBlock } from '@renderer/features/timeline/markdown-math'
import { Copy, ChevronDown } from 'lucide-react'

function CodeBlock({
  className,
  children,
  defaultExpanded,
}: {
  className?: string
  children?: React.ReactNode
  defaultExpanded?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(!!defaultExpanded)
  const [copied, setCopied] = useState(false)
  const lang = /language-(\w+)/.exec(className || '')?.[1] || ''
  const code = String(children ?? '').replace(/\n$/, '')
  const PREVIEW_LINES = 3

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--bg-3)', background: 'var(--bg-2)' }}>
      {lang && (
        <div className="flex items-center justify-between border-b px-3 py-1" style={{ borderColor: 'var(--bg-3)', background: 'var(--bg-3)' }}>
          <span className="font-mono text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--brand)' }}>{lang}</span>
          <button onClick={copy} className="text-[10px] transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={e=>e.currentTarget.style.color='var(--text-primary)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text-secondary)'}>
            {copied ? t('timeline:copied') : t('timeline:copy')}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={copy}
          className="absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
      <pre
        className={cn('overflow-auto p-3 text-[13px] leading-[1.5] font-mono', !expanded && 'max-h-[90px]')}
        style={{ margin: 0, color: 'var(--text-primary)' }}
      >
        <code>{code}</code>
      </pre>
      {code.split('\n').length > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t py-1 text-[10px] transition-colors"
          style={{ borderColor: 'var(--bg-3)', color: 'var(--text-secondary)' }}
          onMouseEnter={e=>e.currentTarget.style.color='var(--text-primary)'}
          onMouseLeave={e=>e.currentTarget.style.color='var(--text-secondary)'}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? t('timeline:collapse') : t('timeline:expand', { count: code.split('\n').length })}
        </button>
      )}
    </div>
  )
}

function buildRemarkPlugins(streaming?: boolean) {
  return [
    remarkGfm,
    remarkBreaks,
    [remarkMath, { singleDollarTextMath: !streaming }] as const,
  ]
}

const REHYPE_PLUGINS = [
  [
    rehypeKatex,
    {
      trust: false,
      strict: 'warn',
      macros: KATEX_MACROS,
      output: 'htmlAndMathml',
    },
  ] as const,
]

const STREAM_MARKDOWN_MIN_CHARS = 160

const MarkdownView = memo(function MarkdownView({
  children,
  className,
  streaming,
}: {
  children: string
  className?: string
  /** 流式中也走 Markdown（对齐 参考桌面客户端 MessageText + MarkdownView） */
  streaming?: boolean
}) {
  const usePlainStream = !!streaming && children.length < STREAM_MARKDOWN_MIN_CHARS

  const markdown = useMemo(
    () => preprocessMarkdownMath(children, { streaming: streaming && !usePlainStream }),
    [children, streaming, usePlainStream],
  )

  const remarkPlugins = useMemo(() => buildRemarkPlugins(streaming && !usePlainStream), [streaming, usePlainStream])

  const components = useMemo(
    () => ({
      code: ({ className: cn2, children: ch, ...rest }: any) => {
        const lang = /language-(\w+)/.exec(cn2 || '')?.[1]?.toLowerCase() || ''
        const raw = String(ch ?? '').replace(/\n$/, '')
        const isInline = !cn2 && !raw.includes('\n')
        if (lang === 'math' || lang === 'latex' || lang === 'tex') {
          return <FencedMathBlock code={raw} />
        }
        if (isInline) {
          return (
            <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[12px] text-foreground/90" {...rest}>
              {ch}
            </code>
          )
        }
        return <CodeBlock className={cn2} defaultExpanded={!!streaming}>{ch}</CodeBlock>
      },
      a: ({ children: ch, ...rest }: any) => (
        <a {...rest} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {ch}
        </a>
      ),
      table: ({ children: ch }: any) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">{ch}</table>
        </div>
      ),
      th: ({ children: ch }: any) => (
        <th className="border border-border/50 bg-muted/40 px-2 py-1 text-left font-medium">{ch}</th>
      ),
      td: ({ children: ch }: any) => <td className="border border-border/50 px-2 py-1">{ch}</td>,
      img: ({ src, alt }: any) => (
        <img src={src} alt={alt} className="my-2 max-w-full rounded-lg border border-border/50" />
      ),
      blockquote: ({ children: ch }: any) => (
        <blockquote className="my-2 border-l-2 border-border/60 pl-3 text-muted-foreground">{ch}</blockquote>
      ),
      ul: ({ children: ch }: any) => <ul className="my-1 ml-4 list-disc space-y-0.5">{ch}</ul>,
      ol: ({ children: ch }: any) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{ch}</ol>,
      h1: ({ children: ch }: any) => <h1 className="mb-1 mt-3 text-[17px] font-semibold">{ch}</h1>,
      h2: ({ children: ch }: any) => <h2 className="mb-1 mt-3 text-[16px] font-semibold">{ch}</h2>,
      h3: ({ children: ch }: any) => <h3 className="mb-1 mt-2 text-[15px] font-semibold">{ch}</h3>,
      p: ({ children: ch }: any) => <p className="my-1 leading-relaxed">{ch}</p>,
      hr: () => <hr className="my-3 border-border/40" />,
    }),
    [streaming],
  )

  if (usePlainStream) {
    return (
      <div className={cn('prose-chat prose-chat-streaming', className)}>
        <p className="stream-plain-chunk my-1 whitespace-pre-wrap break-words">{children}</p>
      </div>
    )
  }

  return (
    <div className={cn('prose-chat', streaming && 'prose-chat-streaming', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownView
