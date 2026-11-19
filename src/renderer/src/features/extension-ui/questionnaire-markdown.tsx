import { memo, useMemo, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@renderer/lib/utils'

const REMARK_PLUGINS = [remarkGfm, remarkBreaks]

const RICH_MD_RE =
  /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)|`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]]+\]\([^)]+\)|\|.+\|\s*\n\s*\|[\s:-]+\|/

const BOX_DRAWING_RE = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬▲▼◀▶]/
const ASCII_BOX_RE = /(^|\n)\s*\+[-=]{3,}\+/

export function hasRichMarkdownSyntax(text: string): boolean {
  if (!text) return false
  return RICH_MD_RE.test(text)
}

/**
 * Pure ASCII diagrams / wireframes (box-drawing or +---+ borders without fenced blocks or rich markdown)
 * look cleaner in a monospace `<pre>` than reflowed as proportional paragraphs.
 */
export function looksLikeAsciiDiagram(text: string): boolean {
  if (!text || text.includes('```')) return false
  if (BOX_DRAWING_RE.test(text) || ASCII_BOX_RE.test(text)) return true
  const lines = text.split('\n')
  if (lines.length >= 4 && !RICH_MD_RE.test(text)) {
    const indented = lines.filter((l) => /^\s{2,}\S/.test(l)).length
    if (indented >= Math.ceil(lines.length * 0.5)) return true
  }
  return false
}

export const QuestionnaireMarkdown = memo(function QuestionnaireMarkdown({
  content,
  compact = false,
  plainHeadings = false,
  className,
}: {
  content: string
  compact?: boolean
  /** Render markdown headings as styled divs so parent dialog title retains the single semantic h2. */
  plainHeadings?: boolean
  className?: string
}) {
  const components = useMemo(
    () => ({
      h1: ({ children }: ComponentPropsWithoutRef<'h1'>) =>
        plainHeadings ? (
          <div className={cn('mb-1 mt-2 font-semibold text-foreground first:mt-0', compact ? 'text-[13px]' : 'text-[15px]')}>{children}</div>
        ) : (
          <h3 className={cn('mb-1 mt-2.5 font-semibold text-foreground first:mt-0', compact ? 'text-[13px]' : 'text-[14.5px]')}>{children}</h3>
        ),
      h2: ({ children }: ComponentPropsWithoutRef<'h2'>) =>
        plainHeadings ? (
          <div className={cn('mb-1 mt-2 font-semibold text-foreground first:mt-0', compact ? 'text-[12.5px]' : 'text-[14px]')}>{children}</div>
        ) : (
          <h4 className={cn('mb-1 mt-2 font-semibold text-foreground first:mt-0', compact ? 'text-[12.5px]' : 'text-[13.5px]')}>{children}</h4>
        ),
      h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <div className={cn('mb-0.5 mt-1.5 font-semibold text-foreground first:mt-0', compact ? 'text-[12px]' : 'text-[13px]')}>
          {children}
        </div>
      ),
      p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p className={cn('my-1 first:mt-0 last:mb-0 break-words [overflow-wrap:anywhere]', compact ? 'leading-[1.45]' : 'leading-[1.55]')}>
          {children}
        </p>
      ),
      ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul className="my-1 ml-4 list-disc space-y-0.5 first:mt-0 last:mb-0">{children}</ul>
      ),
      ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol className="my-1 ml-4 list-decimal space-y-0.5 first:mt-0 last:mb-0">{children}</ol>
      ),
      li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
        <li className="break-words [overflow-wrap:anywhere]">{children}</li>
      ),
      blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="my-1.5 border-l-2 border-border/70 pl-2.5 text-muted-foreground">
          {children}
        </blockquote>
      ),
      pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => (
        <pre className="my-1.5 max-w-full overflow-x-auto rounded-md border border-border/50 bg-background/80 px-2.5 py-2 font-mono text-[11.5px] leading-[1.45] text-foreground/90">
          {children}
        </pre>
      ),
      code: ({ className: codeCls, children }: ComponentPropsWithoutRef<'code'>) => {
        const raw = String(children ?? '')
        const isBlock = Boolean(codeCls) || raw.includes('\n')
        if (isBlock) {
          return <code className={cn('font-mono text-[11.5px]', codeCls)}>{children}</code>
        }
        return (
          <code
            className="rounded px-1 py-px font-mono text-[0.9em] text-foreground break-all"
            style={{ background: 'color-mix(in srgb, var(--bg-3, var(--muted)) 58%, transparent)' }}
          >
            {children}
          </code>
        )
      },
      table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
        <div className="my-1.5 max-w-full overflow-x-auto rounded border border-border/50">
          <table className="w-full border-collapse text-[12px]">{children}</table>
        </div>
      ),
      th: ({ children }: ComponentPropsWithoutRef<'th'>) => (
        <th className="border-b border-r border-border/45 bg-muted/50 px-2 py-1 text-left font-medium last:border-r-0">
          {children}
        </th>
      ),
      td: ({ children }: ComponentPropsWithoutRef<'td'>) => (
        <td className="border-b border-r border-border/35 px-2 py-1 align-top break-words last:border-r-0">
          {children}
        </td>
      ),
      hr: () => <hr className="my-2 border-border/45" />,
      a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary underline-offset-2 hover:underline"
        >
          {children}
        </a>
      ),
    }),
    [compact, plainHeadings],
  )

  return (
    <div className={cn('min-w-0 max-w-full', compact ? 'text-[12px]' : 'text-[13px]', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
