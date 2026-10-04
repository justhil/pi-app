// Nested models.json fields edited in a model entry's "Advanced" section (pi ≥ 0.84):
// samplingParams, samplingParamsByThinkingLevel, inputLimits.images.resize, promptCache.
// Edits keep keys the form does not show and drop objects that become empty.

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Set `path` inside `root` to `value` (undefined removes it), pruning emptied parents. */
export function setIn(root: unknown, path: string[], value: unknown): Obj | undefined {
  const base: Obj = isObj(root) ? { ...root } : {}
  const [head, ...rest] = path
  const next = rest.length ? setIn(base[head], rest, value) : value
  if (next === undefined) delete base[head]
  else base[head] = next
  return Object.keys(base).length ? base : undefined
}

export function getIn(root: unknown, path: string[]): unknown {
  let cur = root
  for (const key of path) {
    if (!isObj(cur)) return undefined
    cur = cur[key]
  }
  return cur
}

/** A number field's text as a value: blank clears, anything else must be a finite number. */
export function parseNumberInput(text: string, opts: { integer?: boolean; min?: number; max?: number } = {}): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  if (opts.integer && !Number.isInteger(n)) return null
  if (opts.min !== undefined && n < opts.min) return null
  if (opts.max !== undefined && n > opts.max) return null
  return n
}

export const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k'] as const
export const IMAGE_RESIZE_KEYS = ['maxWidth', 'maxHeight', 'maxBytes', 'jpegQuality'] as const
export const PROMPT_CACHE_KEYS = ['short', 'long'] as const

/** Whether a model entry has any advanced field set (the section opens by itself then). */
export function hasAdvanced(model: Obj): boolean {
  const compat = isObj(model.compat) ? model.compat : {}
  return (
    ['samplingParams', 'samplingParamsByThinkingLevel', 'inputLimits', 'promptCache'].some((k) => model[k] !== undefined) ||
    compat.supportsMidConvoSystemMessages !== undefined
  )
}
