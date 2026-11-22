// Markdown renderer for assistant messages (参考桌面客户端-inspired).
// react-markdown + remark-gfm + remark-math/rehype-katex + 自定义 code/img/table 组件。
import { memo, useMemo, useRef, useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Pluggable } from 'unified'
import 'katex/dist/katex.min.css'
import 'katex/contrib/mhchem/mhchem.js'
import { cn } from '@renderer/lib/utils'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { highlightCodeToHtml } from '@renderer/lib/shiki-highlighter'
import { useCodeHighlightRevision } from '@renderer/lib/theme/use-code-highlight-revision'
import { preprocessMarkdownMath, KATEX_MACROS } from '@renderer/features/timeline/markdown-math-preprocess'
import { splitOpenUIFence, splitStreamingMarkdown } from '@renderer/features/timeline/markdown-stream-split'
import {
  advanceMarkdownBlocks,
  EMPTY_MARKDOWN_BLOCK_CACHE,
  type MarkdownBlockCache,
} from '@renderer/features/timeline/markdown-blocks'
import { MarkdownPathText } from '@renderer/features/timeline/markdown-inline-paths'
import { MarkdownLink } from '@renderer/features/timeline/markdown-link'
import { FencedMathBlock } from '@renderer/features/timeline/markdown-math'
import { MermaidBlock } from '@renderer/features/timeline/mermaid-block'
import { StreamLiveTailBlock } from '@renderer/features/timeline/stream-text-reveal'
import { Check, ChevronDown, Copy } from '@renderer/components/icons'
import { uiBlockLanguageFromClassName } from '@renderer/features/ui-blocks/protocol'
import { UIBlockHost } from '@renderer/features/ui-blocks/host'
import { localFilePathFromHref } from '@renderer/lib/open-workspace-path'
import { anchorViewportBeforeCollapse } from './collapse-scroll-anchor'

export const CODE_FOLD_THRESHOLD_LINES = 24
export const CODE_PREVIEW_LINES = 14

const markdownUrlTransform: UrlTransform = (url, key) =>
  key === 'href' && localFilePathFromHref(url) ? url : defaultUrlTransform(url)

/** `<pre>` whose code child renders its own block chrome (CodeBlock, pi-ui, mermaid, math). */
function isSelfRenderingPre(node: ExtraProps['node']): boolean {
  const code = node?.children?.find((child) => child.type === 'element')
  return !!code && code.type === 'element' && code.tagName === 'code'
}

/**
 * Shared IntersectionObserver so prepending dozens of historical code blocks offscreen does not
 * fire 20+ concurrent Shiki highlighting tasks on the same frame. Highlights lazily within 450px
 * of the viewport (falls back to immediate in environments without IntersectionObserver).
 */
let sharedCodeObserver: IntersectionObserver | null = null
const codeObserverCallbacks = new WeakMap<Element, () => void>()

function observeCodeBlockNearViewport(el: Element, onNear: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onNear()
    return () => {}
  }
  if (!sharedCodeObserver) {
    sharedCodeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const cb = codeObserverCallbacks.get(entry.target)
          codeObserverCallbacks.delete(entry.target)
          sharedCodeObserver?.unobserve(entry.target)
          cb?.()
        }
      },
      { rootMargin: '450px 0px' },
    )
  }
  codeObserverCallbacks.set(el, onNear)
  sharedCodeObserver.observe(el)
  return () => {
    codeObserverCallbacks.delete(el)
    sharedCodeObserver?.unobserve(el)
  }
}

function CodeBlock({
  className,
  children,
  streaming,
}: {
  className?: string
  children?: React.ReactNode
  streaming?: boolean
}) {
  const { t } = useTranslation()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined')
  const lang = /language-([\w-]+)/.exec(className || '')?.[1] || ''
  const code = String(children ?? '').replace(/\n$/, '')
  const lineCount = code.split('\n').length
  const needsFold = !streaming && lineCount > CODE_FOLD_THRESHOLD_LINES
  const expanded = userExpanded ?? !needsFold
  const isCollapsed = needsFold && !expanded
  const isExpandedFoldable = needsFold && expanded
  const themeRev = useCodeHighlightRevision()

  useEffect(() => {
    if (nearViewport || streaming || !lang || !code) return
    const node = surfaceRef.current
    if (!node) return
    return observeCodeBlockNearViewport(node, () => setNearViewport(true))
  }, [nearViewport, streaming, lang, code])

  useEffect(() => {
    if (streaming || !lang || !code || !nearViewport) {
      setHtml(null)
      return
    }
    let cancelled = false
    void highlightCodeToHtml(code, lang).then((res) => {
      if (!cancelled) setHtml(res)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang, streaming, themeRev, nearViewport])

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleCollapse = () => {
    anchorViewportBeforeCollapse(surfaceRef.current)
    setUserExpanded(false)
  }

  return (
    <div
      ref={surfaceRef}
      data-pi-slot="timeline-code-block"
      className={cn(
        'code-surface group relative my-2.5 rounded-lg border border-border/55 transition-colors',
        !isExpandedFoldable && 'overflow-hidden',
      )}
      style={{ background: 'var(--code-bg, color-mix(in srgb, var(--bg-2) 55%, transparent))' }}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b border-border/35 px-3 py-1',
          isExpandedFoldable && 'sticky top-0 z-10 rounded-t-[7px] backdrop-blur-sm',
        )}
        style={{
          background: isExpandedFoldable
            ? 'color-mix(in srgb, var(--bg-2) 92%, var(--bg-base))'
            : 'color-mix(in srgb, var(--bg-3) 26%, transparent)',
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] tracking-wide text-foreground-secondary/65">
          <span className="uppercase">{lang || t('timeline:code')}</span>
          {lineCount > 1 && (
            <span className="text-foreground-secondary/45">
              · {t('timeline:previews.lines', { count: lineCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isExpandedFoldable && (
            <button
              type="button"
              onClick={handleCollapse}
              className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-foreground-secondary/75 transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <ChevronDown className="h-3 w-3 rotate-180" />
              <span>{t('timeline:collapse')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t('timeline:copied') : t('timeline:copy')}
            title={copied ? t('timeline:copied') : t('timeline:copy')}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-foreground-secondary/60 transition-opacity hover:bg-[var(--bg-hover)] hover:text-foreground focus-visible:opacity-100',
              isExpandedFoldable ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <div className={cn('relative', isExpandedFoldable && 'overflow-hidden rounded-b-[7px]')}>
        {html != null && !streaming ? (
          <div
            className={cn(
              'native-code-shiki px-3 py-2.5 text-[12.5px] leading-[1.55] font-mono [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:overflow-x-auto [&_code]:text-[12.5px]',
              isCollapsed ? 'max-h-[19.25rem] overflow-hidden' : 'overflow-x-auto overflow-y-visible',
            )}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        ) : (
          <pre
            className={cn(
              'px-3 py-2.5 text-[12.5px] leading-[1.55] font-mono',
              isCollapsed ? 'max-h-[19.25rem] overflow-hidden' : 'overflow-x-auto overflow-y-visible',
            )}
            style={{ margin: 0, color: 'var(--text-primary)' }}
          >
            <code>{code}</code>
          </pre>
        )}
        {isCollapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{
              background:
                'linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--bg-2) 86%, var(--bg-base)) 100%)',
            }}
          />
        )}
      </div>
      {needsFold && (
        <button
          type="button"
          onClick={() => (expanded ? handleCollapse() : setUserExpanded(true))}
          aria-expanded={expanded}
          aria-label={expanded ? t('timeline:collapse') : t('timeline:expand', { count: lineCount })}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 border-t border-border/35 py-1 text-[11.5px] text-foreground-secondary/75 transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground',
            isExpandedFoldable && 'rounded-b-[7px]',
          )}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          <span>{expanded ? t('timeline:collapse') : t('timeline:expand', { count: lineCount })}</span>
        </button>
      )}
    </div>
  )
}

function buildRemarkPlugins(streaming?: boolean): Pluggable[] {
  return [
    remarkGfm,
    remarkBreaks,
    [remarkMath, { singleDollarTextMath: !streaming }],
  ]
}

const REHYPE_PLUGINS: Pluggable[] = [
  [
    rehypeKatex,
    {
      trust: false,
      // 'warn' 只会刷控制台（中文进公式等），渲染结果不变
      strict: 'ignore',
      macros: KATEX_MACROS,
      output: 'htmlAndMathml',
    },
  ],
]

const STREAM_PLAIN_ONLY_MAX = 96

const SETTLED_REMARK_PLUGINS = buildRemarkPlugins(false)

/** One top-level block of a streaming answer; unchanged blocks skip Markdown/KaTeX re-parsing. */
const MarkdownBlock = memo(function MarkdownBlock({
  source,
  components,
}: {
  source: string
  components: Components
}) {
  const markdown = useMemo(() => preprocessMarkdownMath(source, { streaming: false }), [source])
  return (
    <ReactMarkdown remarkPlugins={SETTLED_REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components} urlTransform={markdownUrlTransform}>
      {markdown}
    </ReactMarkdown>
  )
})

/**
 * Committed streaming prefix rendered block by block: each frame re-parses only the growing tail
 * blocks instead of the whole answer (streaming cost no longer grows with answer length).
 */
function StreamingMarkdownBlocks({ source, components }: { source: string; components: Components }) {
  const cacheRef = useRef<MarkdownBlockCache>(EMPTY_MARKDOWN_BLOCK_CACHE)
  if (cacheRef.current.source !== source) {
    cacheRef.current = advanceMarkdownBlocks(cacheRef.current, source)
  }
  return (
    <>
      {cacheRef.current.blocks.map((block, index) => (
        <MarkdownBlock key={index} source={block} components={components} />
      ))}
    </>
  )
}

/**
 * 流式尾部是否含块级语法（表格/标题/列表/引用/代码块）。
 * 这些结构在纯文本尾部会显示成原始符号，需要走 Markdown 渲染才能实时成型。
 */
function tailHasBlockSyntax(text: string): boolean {
  if (!text) return false
  return (
    /(^|\n)\s{0,3}#{1,6}\s/.test(text) || // 标题
    /(^|\n)\s{0,3}>/.test(text) || // 引用
    /(^|\n)\s{0,3}([-*+]\s|\d+[.)]\s)/.test(text) || // 列表
    /(^|\n)\s{0,3}```/.test(text) || // 代码块
    /(^|\n)\s{0,3}\|/.test(text) // 表格行（含分隔行，行首以 | 开头）
  )
}

const MarkdownView = memo(function MarkdownView({
  children,
  className,
  streaming,
  baseDirectory,
}: {
  children: string
  className?: string
  /** 流式：稳定前缀 Markdown + 尾部纯文本（减少整段重排，接近 ChatGPT） */
  streaming?: boolean
  /** Relative links in a file preview resolve from that file's directory. */
  baseDirectory?: string
}) {
  const committedStableRef = useRef('')

  useEffect(() => {
    if (!streaming) committedStableRef.current = ''
  }, [streaming])

  const streamSplit = useMemo(
    () => (streaming ? splitStreamingMarkdown(children) : { committed: '', tail: children }),
    [children, streaming],
  )

  if (streaming && streamSplit.committed.length >= committedStableRef.current.length) {
    committedStableRef.current = streamSplit.committed
  }

  const committedPrefix = streaming ? committedStableRef.current : ''
  const liveTail = streaming ? children.slice(committedPrefix.length) : ''
  const usePlainStream =
    !!streaming &&
    !committedPrefix &&
    liveTail.length > 0 &&
    liveTail.length <= STREAM_PLAIN_ONLY_MAX &&
    !tailHasBlockSyntax(liveTail)

  const markdown = useMemo(
    () =>
      preprocessMarkdownMath(streaming && committedPrefix ? committedPrefix : children, {
        streaming: !!streaming && (!usePlainStream || !!committedPrefix),
      }),
    [children, streaming, usePlainStream, committedPrefix],
  )

  const remarkPlugins = useMemo(
    () => buildRemarkPlugins(!!streaming && (!usePlainStream || !!committedPrefix)),
    [streaming, usePlainStream, committedPrefix],
  )

  const components = useMemo(
    () => ({
      code: ({ className: cn2, children: ch, ...rest }: ComponentPropsWithoutRef<'code'>) => {
        const lang = /language-([\w-]+)/.exec(cn2 || '')?.[1]?.toLowerCase() || ''
        const rawText = String(ch ?? '')
        const raw = rawText.replace(/\n$/, '')
        const isInline = !cn2 && !rawText.includes('\n')
        if (lang === 'math' || lang === 'latex' || lang === 'tex') {
          return <FencedMathBlock code={raw} />
        }
        if (uiBlockLanguageFromClassName(cn2)) {
          return <UIBlockHost raw={raw} streaming={!!streaming} />
        }
        if (lang === 'mermaid') {
          return <MermaidBlock code={raw} streaming={!!streaming} />
        }
        if (isInline) {
          return <code {...rest}>{ch}</code>
        }
        return (
          <CodeBlock className={cn2} streaming={streaming}>
            {ch}
          </CodeBlock>
        )
      },
      // pi-ui and mermaid blocks render their own chrome; don't wrap them in <pre> (monospace, white-space: pre).
      pre: ({ node, children: ch, ...rest }: ComponentPropsWithoutRef<'pre'> & ExtraProps) =>
        isSelfRenderingPre(node) ? <>{ch}</> : <pre {...rest}>{ch}</pre>,
      a: ({ children: ch, node: _node, ...rest }: ComponentPropsWithoutRef<'a'> & ExtraProps) => (
        <MarkdownLink {...rest} baseDirectory={baseDirectory} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {ch}
        </MarkdownLink>
      ),
      table: ({ children: ch }: ComponentPropsWithoutRef<'table'>) => (
        <div data-pi-slot="timeline-table" className="my-3 max-w-full overflow-x-auto rounded-lg border border-border/55">
          <table className="w-max min-w-[50%] max-w-full border-collapse text-[13px]">{ch}</table>
        </div>
      ),
      th: ({ children: ch }: ComponentPropsWithoutRef<'th'>) => <th>{ch}</th>,
      td: ({ children: ch }: ComponentPropsWithoutRef<'td'>) => <td>{ch}</td>,
      img: ({ src, alt }: ComponentPropsWithoutRef<'img'>) => (
        <img src={src} alt={alt} className="my-2.5 max-w-full rounded-lg border border-border/45" />
      ),
      blockquote: ({ children: ch }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote>{ch}</blockquote>
      ),
      ul: ({ children: ch }: ComponentPropsWithoutRef<'ul'>) => <ul className="list-disc">{ch}</ul>,
      ol: ({ children: ch }: ComponentPropsWithoutRef<'ol'>) => <ol className="list-decimal">{ch}</ol>,
      p: ({ children: ch }: ComponentPropsWithoutRef<'p'>) => {
        if (typeof ch === 'string') {
          return (
            <p>
              <MarkdownPathText text={ch} />
            </p>
          )
        }
        return <p>{ch}</p>
      },
      hr: () => <hr />,
    }),
    [streaming, baseDirectory],
  )

  if (usePlainStream) {
    return (
      <div className={cn('prose-chat prose-chat-streaming', className)}>
        <StreamLiveTailBlock text={liveTail} streaming />
      </div>
    )
  }

  if (streaming && (committedPrefix || liveTail)) {
    // An unclosed pi-ui fence bypasses Markdown: its body feeds the block host directly.
    const openUIFence = liveTail ? splitOpenUIFence(liveTail) : null
    const tailMarkdown = openUIFence ? openUIFence.before : liveTail
    return (
      <div className={cn('prose-chat prose-chat-streaming prose-chat-streaming-split', className)}>
        {committedPrefix ? (
          <StreamingMarkdownBlocks source={committedPrefix} components={components as Components} />
        ) : null}
        {tailMarkdown ? (
          tailHasBlockSyntax(tailMarkdown) ? (
            <ReactMarkdown
              remarkPlugins={SETTLED_REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={components}
              urlTransform={markdownUrlTransform}
            >
              {preprocessMarkdownMath(tailMarkdown, { streaming: false })}
            </ReactMarkdown>
          ) : (
            <StreamLiveTailBlock text={tailMarkdown} streaming />
          )
        ) : null}
        {openUIFence ? <UIBlockHost raw={openUIFence.raw} streaming /> : null}
      </div>
    )
  }

  return (
    <div className={cn('prose-chat', streaming && 'prose-chat-streaming', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={components} urlTransform={markdownUrlTransform}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownView
