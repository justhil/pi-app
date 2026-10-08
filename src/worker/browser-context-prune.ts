// Old browser_* results describe pages that have since changed: snapshots, diffs and screenshots the
// model no longer needs, resent on every request. Before each LLM call they are cut down to their
// one-line outcome (and the page they were on). Only what is sent changes; the session keeps all.
//
// Prompt caching: rewriting history breaks the cached prefix from the first changed message. So
// results are not elided one by one as they age: a checkpoint is set each time CHECKPOINT_CHARS of
// browser output has piled up, and everything before the latest checkpoint is elided in one go. The
// checkpoints depend only on earlier messages, so the elided set only grows, and the prefix changes
// about once per CHECKPOINT_CHARS of browser output instead of on every step.

type Part = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: string; [k: string]: unknown }
type Msg = { role: string; toolName?: string; isError?: boolean; content?: unknown }

export const CHECKPOINT_CHARS = 24_000
/** A screenshot weighs about this much (≈1.5k tokens) when counting toward a checkpoint. */
const IMAGE_CHARS = 6_000
/** Results this small are kept whole (errors, "Saved …", "Pressed Tab"). */
const KEEP_BELOW_CHARS = 800
/** Sections worth keeping from an old result: what was done and where. */
const KEEP_SECTIONS = new Set(['Result', 'Page', 'Steps'])
const NOTE = '[Older page state removed to save context. Refs from it may be stale; browser_snapshot shows the current page.]'

const isBrowserResult = (m: Msg) => m.role === 'toolResult' && typeof m.toolName === 'string' && m.toolName.startsWith('browser_') && Array.isArray(m.content)

function weight(content: Part[]): number {
  return content.reduce((n, c) => n + (c.type === 'text' ? String((c as { text: string }).text).length : c.type === 'image' ? IMAGE_CHARS : 0), 0)
}

/** The kept sections of one result's text ("### Name" blocks); empty when none apply. */
function keptSections(text: string): string {
  const blocks = text.split(/\n(?=### )/)
  return blocks
    .filter((b) => {
      const m = /^### ([A-Za-z]+)/.exec(b)
      return m && KEEP_SECTIONS.has(m[1])
    })
    .map((b) => b.trim())
    .join('\n')
}

function elide(content: Part[]): Part[] {
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n')
  const kept = keptSections(text)
  const images = content.filter((c) => c.type === 'image').length
  const shot = images ? `[${images === 1 ? 'Screenshot' : `${images} screenshots`} removed.]` : ''
  return [{ type: 'text', text: [kept, shot, NOTE].filter(Boolean).join('\n') }]
}

/** Messages with old browser results elided, or undefined when nothing changes. */
export function pruneBrowserResults<M extends Msg>(messages: M[]): M[] | undefined {
  const browser: number[] = []
  messages.forEach((m, i) => isBrowserResult(m) && browser.push(i))
  let checkpoint = -1
  let acc = 0
  for (let k = 0; k < browser.length; k++) {
    acc += weight(messages[browser[k]].content as Part[])
    if (acc >= CHECKPOINT_CHARS) {
      checkpoint = k
      acc = 0
    }
  }
  if (checkpoint <= 0) return undefined
  let changed = false
  const out = messages.slice()
  for (let k = 0; k < checkpoint; k++) {
    const i = browser[k]
    const m = messages[i]
    const content = m.content as Part[]
    if (m.isError || weight(content) < KEEP_BELOW_CHARS) continue
    out[i] = { ...m, content: elide(content) }
    changed = true
  }
  return changed ? out : undefined
}
