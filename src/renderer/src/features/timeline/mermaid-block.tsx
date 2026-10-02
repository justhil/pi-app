import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { Check, Copy } from '@renderer/components/icons'
import type { MermaidResult, MermaidTheme } from './mermaid-render'

const MAX_CACHE = 60
/** theme key + source → result, so a block remounted by the streaming → settled switch paints at once. */
const resultCache = new Map<string, MermaidResult>()

function cacheResult(key: string, result: MermaidResult): void {
  resultCache.delete(key)
  resultCache.set(key, result)
  if (resultCache.size > MAX_CACHE) resultCache.delete(resultCache.keys().next().value!)
}

function subscribeDark(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  return () => observer.disconnect()
}

const readDark = () => document.documentElement.classList.contains('dark')

function readTheme(dark: boolean): MermaidTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    dark,
    fontFamily: getComputedStyle(document.body).fontFamily || 'sans-serif',
    background: v('--bg-base', dark ? '#16171c' : '#ffffff'),
    surface: v('--bg-2', dark ? '#25262e' : '#f2f3f5'),
    surfaceAlt: v('--bg-1', dark ? '#1c1d23' : '#f9fafb'),
    text: v('--text-primary', dark ? '#eceef4' : '#12141a'),
    textMuted: v('--text-secondary', dark ? '#a4a9b8' : '#454d5f'),
    line: v('--bg-3', dark ? '#33353f' : '#e5e6eb'),
    accent: v('--brand', dark ? '#8b93b0' : '#7583b2'),
    accentSoft: v('--brand-light', dark ? '#262a38' : '#eff0f6'),
  }
}

/**
 * ```mermaid fence. While the answer streams the source is shown as code (a half-written diagram
 * would re-layout on every token); once settled it renders to SVG, falling back to the source
 * with the parser's message when the diagram is invalid.
 */
export function MermaidBlock({ code, streaming }: { code: string; streaming: boolean }) {
  const { t } = useTranslation()
  const dark = useSyncExternalStore(subscribeDark, readDark)
  const key = `${dark ? 'd' : 'l'}\n${code}`
  const [result, setResult] = useState<MermaidResult | undefined>(() => resultCache.get(key))
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (streaming) return
    const cached = resultCache.get(key)
    if (cached) {
      setResult(cached)
      return
    }
    let cancelled = false
    void import('./mermaid-render')
      .then(({ renderMermaid }) => renderMermaid(code, readTheme(dark)))
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
      .then((next) => {
        cacheResult(key, next)
        if (!cancelled) setResult(next)
      })
    return () => {
      cancelled = true
    }
  }, [code, dark, key, streaming])

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const svg = !streaming && result && 'svg' in result ? result.svg : undefined
  const error = !streaming && result && 'error' in result ? result.error : undefined
  const pending = !streaming && !result
  const sourceVisible = streaming || showSource || !!error

  return (
    <div
      className="group relative my-1.5 overflow-hidden rounded-md border border-border/35"
      style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}
      data-mermaid-state={streaming ? 'streaming' : svg ? 'rendered' : error ? 'error' : 'pending'}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-border/30 px-2 py-0.5"
        style={{ background: 'color-mix(in srgb, var(--bg-3) 28%, transparent)' }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wide text-foreground-secondary/55">mermaid</span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {svg && (
            <button
              type="button"
              onClick={() => setShowSource((value) => !value)}
              className="rounded px-1.5 text-[11px] leading-5 text-foreground-secondary/60 hover:text-foreground"
            >
              {showSource ? t('timeline:mermaidShowDiagram') : t('timeline:mermaidShowSource')}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t('timeline:copied') : t('timeline:copy')}
            title={copied ? t('timeline:copied') : t('timeline:copy')}
            className="flex h-5 w-5 items-center justify-center rounded text-foreground-secondary/50 hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {svg && !showSource && (
        <div
          data-independent-scroll
          className="mermaid-diagram overflow-x-auto overscroll-contain px-3 py-3 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:!max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {pending && (
        <div className="flex min-h-[7.5rem] items-center justify-center text-[12px] text-foreground-secondary/55">
          {t('timeline:mermaidRendering')}
        </div>
      )}
      {sourceVisible && (
        <pre
          data-independent-scroll
          className={cn('overflow-auto overscroll-contain px-2.5 py-2 text-[12.5px] leading-[1.5] font-mono', !streaming && 'max-h-80')}
          style={{ margin: 0, color: 'var(--text-primary)' }}
        >
          <code>{code}</code>
        </pre>
      )}
      {error && (
        <div className="border-t border-border/30 px-2.5 py-1 text-[11.5px] text-foreground-secondary/70">
          {t('timeline:mermaidError', { error })}
        </div>
      )}
    </div>
  )
}
