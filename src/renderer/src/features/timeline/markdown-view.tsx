// Markdown renderer for assistant messages (桌面 Agent UI-inspired).
// react-markdown + remark-gfm (GFM tables/task lists/strikethrough) + 自定义 code/img/table 组件。
// 代码块默认折叠到 3 行预览，点击展开；图片走内联；表格可滚动。
import { memo, useState, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@renderer/lib/utils'
import { Copy, ChevronDown } from 'lucide-react'

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
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
    <div className="group relative my-2 overflow-hidden rounded-lg border border-border/50 bg-[#0d1117]">
      {lang && (
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-1">
          <span className="font-mono text-[10px] text-zinc-400">{lang}</span>
          <button onClick={copy} className="text-[10px] text-zinc-500 hover:text-zinc-200">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={copy}
          className="absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
      <pre
        className={cn('overflow-auto p-3 text-[12px] leading-[20px]', !expanded && 'max-h-[86px]')}
        style={{ margin: 0 }}
      >
        <code className="font-mono text-zinc-200">{code}</code>
      </pre>
      {code.split('\n').length > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-white/5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? '收起' : `展开 (${code.split('\n').length} 行)`}
        </button>
      )}
    </div>
  )
}

const MarkdownView = memo(function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-chat', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className: cn2, children: ch, ...rest }: any) => {
            // inline code (no language- class and single line) vs block
            const isInline = !cn2 && !String(ch).includes('\n')
            if (isInline) {
              return (
                <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[11px] text-foreground/90" {...rest}>
                  {ch}
                </code>
              )
            }
            return <CodeBlock className={cn2}>{ch}</CodeBlock>
          },
          a: ({ children: ch, ...rest }: any) => (
            <a {...rest} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {ch}
            </a>
          ),
          table: ({ children: ch }: any) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{ch}</table>
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
          h1: ({ children: ch }: any) => <h1 className="mb-1 mt-3 text-[16px] font-semibold">{ch}</h1>,
          h2: ({ children: ch }: any) => <h2 className="mb-1 mt-3 text-[15px] font-semibold">{ch}</h2>,
          h3: ({ children: ch }: any) => <h3 className="mb-1 mt-2 text-[14px] font-semibold">{ch}</h3>,
          p: ({ children: ch }: any) => <p className="my-1 leading-relaxed">{ch}</p>,
          hr: () => <hr className="my-3 border-border/40" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownView
