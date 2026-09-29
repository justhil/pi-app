/**
 * Split assistant stream into a stable markdown prefix and a live plain tail (ChatGPT-style).
 * The prefix is re-parsed only when a safe boundary advances; the tail grows without full-doc reflow.
 */
export function splitStreamingMarkdown(text: string): { committed: string; tail: string } {
  if (!text) return { committed: '', tail: '' }
  const cut = outsideOpenFence(text, findCut(text))
  return cut > 0 ? { committed: text.slice(0, cut), tail: text.slice(cut) } : { committed: '', tail: text }
}

function findCut(text: string): number {
  const minTail = 28

  const paraIdx = text.lastIndexOf('\n\n')
  if (paraIdx >= 0 && text.length - (paraIdx + 2) >= minTail) return paraIdx + 2

  const lineIdx = text.lastIndexOf('\n')
  if (lineIdx >= 0 && text.length - (lineIdx + 1) >= minTail * 2) return lineIdx + 1

  let lastSentEnd = -1
  const re = /[.!?。！？…]["')\]]*\s+/g
  for (const m of text.matchAll(re)) {
    lastSentEnd = (m.index ?? 0) + m[0].length
  }
  if (lastSentEnd > 0 && text.length - lastSentEnd >= minTail && lastSentEnd >= Math.min(80, text.length * 0.2)) {
    return lastSentEnd
  }
  return 0
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/gm

/**
 * Never commit half of a fenced block: when the cut lands inside an open ``` / ~~~ fence, move it
 * back to the fence's first line so the whole block stays in the live tail and renders as one
 * code block (or one pi-ui block skeleton) instead of code above + raw text below.
 */
function outsideOpenFence(text: string, cut: number): number {
  if (cut <= 0) return 0
  const head = text.slice(0, cut)
  if (!head.includes('```') && !head.includes('~~~')) return cut
  let open: { index: number; marker: string } | null = null
  for (const match of head.matchAll(FENCE_LINE)) {
    const marker = match[1]
    if (!open) open = { index: match.index ?? 0, marker }
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && !match[2].trim()) open = null
  }
  return open ? open.index : cut
}

const UI_FENCE_INFO = /^(pi-ui|deeix-ui)\b/i

/**
 * When the live tail ends inside a still-open pi-ui fence, return the Markdown before it and the
 * fence body so far. The body goes straight to the UI block host (a skeleton until the JSON
 * closes) instead of re-parsing an ever-growing code block as Markdown on every frame.
 */
export function splitOpenUIFence(tail: string): { before: string; raw: string } | null {
  if (!tail.includes('```') && !tail.includes('~~~')) return null
  let open: { index: number; marker: string; info: string; bodyStart: number } | null = null
  for (const match of tail.matchAll(FENCE_LINE)) {
    const marker = match[1]
    const info = match[2].trim()
    const index = match.index ?? 0
    if (!open) {
      const lineEnd = tail.indexOf('\n', index)
      open = { index, marker, info, bodyStart: lineEnd === -1 ? -1 : lineEnd + 1 }
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && !info) {
      open = null
    }
  }
  if (!open || open.bodyStart < 0 || !UI_FENCE_INFO.test(open.info)) return null
  return { before: tail.slice(0, open.index), raw: tail.slice(open.bodyStart) }
}
