import { useMemo } from 'react'
import katex from 'katex'
import { cn } from '@renderer/lib/utils'
import { KATEX_MACROS } from '@renderer/features/timeline/markdown-math-preprocess'

const KATEX_OPTS = {
  throwOnError: false,
  strict: 'warn' as const,
  trust: false,
  macros: KATEX_MACROS,
  output: 'htmlAndMathml' as const,
}

export function renderKatexHtml(latex: string, displayMode: boolean): { html: string; error?: boolean } {
  try {
    const html = katex.renderToString(latex.trim(), { ...KATEX_OPTS, displayMode })
    return { html }
  } catch {
    try {
      const html = katex.renderToString(latex.trim(), {
        ...KATEX_OPTS,
        displayMode,
        strict: 'ignore',
      })
      return { html, error: true }
    } catch {
      return {
        html: `<span class="katex-fallback">${escapeHtml(latex.slice(0, 200))}</span>`,
        error: true,
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Fenced ```math / ```latex（预处理后）— 与 rehype 双保险，组件层直渲 */
export function FencedMathBlock({ code, className }: { code: string; className?: string }) {
  const { html, error } = useMemo(() => renderKatexHtml(code, true), [code])
  return (
    <div
      className={cn(
        'math-display-shell my-3 overflow-x-auto rounded-lg border border-border/45 bg-muted/15 px-4 py-3',
        error && 'math-render-error',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function InlineMathSpan({ code, className }: { code: string; className?: string }) {
  const { html, error } = useMemo(() => renderKatexHtml(code, false), [code])
  return (
    <span
      className={cn('math-inline-shell', error && 'math-render-error', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}