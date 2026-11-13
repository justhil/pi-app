import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import type { Pluggable } from 'unified'

/**
 * KaTeX loads the first time a message can contain math, not with the Markdown renderer: most
 * answers have none. Until it lands, math source shows as written; every mounted Markdown view
 * then re-renders with formulas. Once loaded it stays on for the rest of the session.
 */
export type KatexRuntime = {
  rehypePlugins: Pluggable[]
  FencedMathBlock: ComponentType<{ code: string; className?: string }>
}

let runtime: KatexRuntime | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/**
 * Whether the text can produce math: a `$` (remark-math), LaTeX `\(` / `\[` delimiters (rewritten
 * to `$` by the preprocessor), or a math / latex / tex fence. Deliberately a superset — a false
 * positive only loads KaTeX early.
 */
export function mayContainMath(text: string): boolean {
  return text.includes('$') || text.includes('\\(') || text.includes('\\[') || /(?:```|~~~)\s*(?:math|latex|tex)\b/i.test(text)
}

export function ensureKatex(): Promise<void> {
  if (runtime) return Promise.resolve()
  loading ??= import('./markdown-katex')
    .then((m) => {
      runtime = { rehypePlugins: m.KATEX_REHYPE_PLUGINS, FencedMathBlock: m.FencedMathBlock }
      for (const listener of [...listeners]) listener()
    })
    .catch((error: unknown) => {
      // Retried by the next view that needs math; formulas stay as source meanwhile.
      loading = null
      console.warn('[markdown] Unable to load KaTeX', error)
    })
  return loading
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getRuntime = (): KatexRuntime | null => runtime

/** The KaTeX runtime once loaded (null before); asks for it when `needed`. */
export function useKatexRuntime(needed: boolean): KatexRuntime | null {
  const current = useSyncExternalStore(subscribe, getRuntime, getRuntime)
  useEffect(() => {
    if (needed && !current) void ensureKatex()
  }, [needed, current])
  return current
}
