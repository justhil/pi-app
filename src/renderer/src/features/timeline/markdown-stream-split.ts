/**
 * Split assistant stream into a stable markdown prefix and a live plain tail (ChatGPT-style).
 * The prefix is re-parsed only when a safe boundary advances; the tail grows without full-doc reflow.
 */
export function splitStreamingMarkdown(text: string): { committed: string; tail: string } {
  if (!text) return { committed: '', tail: '' }

  const minTail = 28

  const paraIdx = text.lastIndexOf('\n\n')
  if (paraIdx >= 0 && text.length - (paraIdx + 2) >= minTail) {
    const cut = paraIdx + 2
    return { committed: text.slice(0, cut), tail: text.slice(cut) }
  }

  const lineIdx = text.lastIndexOf('\n')
  if (lineIdx >= 0 && text.length - (lineIdx + 1) >= minTail * 2) {
    const cut = lineIdx + 1
    return { committed: text.slice(0, cut), tail: text.slice(cut) }
  }

  let lastSentEnd = -1
  const re = /[.!?。！？…]["')\]]*\s+/g
  for (const m of text.matchAll(re)) {
    lastSentEnd = (m.index ?? 0) + m[0].length
  }
  if (lastSentEnd > 0 && text.length - lastSentEnd >= minTail && lastSentEnd >= Math.min(80, text.length * 0.2)) {
    return { committed: text.slice(0, lastSentEnd), tail: text.slice(lastSentEnd) }
  }

  return { committed: '', tail: text }
}