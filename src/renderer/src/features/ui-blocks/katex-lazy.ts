import { useEffect, useSyncExternalStore } from 'react'

type KatexRenderFn = (tex: string) => string

let renderKatex: KatexRenderFn | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function ensureUiBlockKatex(): Promise<void> {
  if (renderKatex) return Promise.resolve()
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    .then(([mod]) => {
      const katex = mod.default ?? mod
      renderKatex = (tex: string) =>
        katex.renderToString(tex, { throwOnError: false, output: 'html', strict: 'ignore' })
      for (const cb of [...listeners]) cb()
    })
    .catch((err) => {
      loading = null
      console.warn('[pi-ui] Unable to load KaTeX runtime', err)
    })
  return loading
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const getSnapshot = (): KatexRenderFn | null => renderKatex

/**
 * Loads KaTeX + katex.min.css on demand only when a `formula` or `function-plot` block mounts,
 * keeping static charts/tables free of KaTeX while guaranteeing stylesheet availability even
 * when Markdown math has not loaded yet.
 */
export function useUiBlockKatex(): KatexRenderFn | null {
  const fn = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (!fn) void ensureUiBlockKatex()
  }, [fn])
  return fn
}
