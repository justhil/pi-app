import { describe, expect, it } from 'vitest'
import { CHECKPOINT_CHARS, pruneBrowserResults } from './browser-context-prune'

const big = (n: number) => 'x'.repeat(n)
const click = (i: number, size = 9_000) => ({
  role: 'toolResult',
  toolName: 'browser_click',
  isError: false,
  content: [{ type: 'text', text: `### Result\nClicked button "Go ${i}"\n### Page\nURL: https://a.test/${i}\nTitle: A\n### Changes\n${big(size)}` }],
})
const user = { role: 'user', content: 'hi' }
const textOf = (m: { content?: unknown }): string => typeof m.content === 'string' ? m.content : (m.content as { type: string; text?: string }[]).map((c) => c.text ?? `[${c.type}]`).join('\n')

describe('pruneBrowserResults', () => {
  it('leaves history alone until a checkpoint has piled up', () => {
    expect(pruneBrowserResults([user, click(1), click(2)])).toBeUndefined()
  })

  it('elides everything before the latest checkpoint to its outcome and page', () => {
    const msgs = [user, click(1), click(2), click(3), click(4)]
    const out = pruneBrowserResults(msgs)!
    // 9k each: the checkpoint falls on the 3rd result; the 1st and 2nd are elided, the rest kept.
    expect(textOf(out[1])).toBe('### Result\nClicked button "Go 1"\n### Page\nURL: https://a.test/1\nTitle: A\n[Older page state removed to save context. Refs from it may be stale; browser_snapshot shows the current page.]')
    expect(textOf(out[2])).toMatch(/^### Result\nClicked button "Go 2"[\s\S]*Older page state removed/)
    expect(out[3]).toBe(msgs[3])
    expect(out[4]).toBe(msgs[4])
    expect(textOf(msgs[1])).toContain('### Changes') // the input is not modified
  })

  it('keeps the elided prefix stable as the conversation grows (prompt cache)', () => {
    const msgs = [user, click(1), click(2), click(3), click(4)]
    const first = pruneBrowserResults(msgs)!
    const later = pruneBrowserResults([...msgs, click(5)])!
    expect(later.slice(0, first.length).map(textOf)).toEqual(first.map(textOf))
  })

  it('keeps errors and small results, replaces screenshots with a note', () => {
    const shot = { role: 'toolResult', toolName: 'browser_take_screenshot', isError: false, content: [{ type: 'image', data: big(10), mimeType: 'image/png' }, { type: 'text', text: 'Screenshot 1280×800' }] }
    const err = { role: 'toolResult', toolName: 'browser_click', isError: true, content: [{ type: 'text', text: `browser_timeout ${big(2000)}` }] }
    const small = { role: 'toolResult', toolName: 'browser_press_key', isError: false, content: [{ type: 'text', text: '### Result\nPressed Tab' }] }
    const out = pruneBrowserResults([shot, err, small, click(1, CHECKPOINT_CHARS)])!
    expect(textOf(out[0])).toMatch(/^\[Screenshot removed\.\]\n\[Older page state removed/)
    expect(out[1]).toBe(err)
    expect(out[2]).toBe(small)
  })

  it('ignores other tools', () => {
    const read = { role: 'toolResult', toolName: 'read', isError: false, content: [{ type: 'text', text: big(CHECKPOINT_CHARS * 2) }] }
    expect(pruneBrowserResults([read, read, click(1)])).toBeUndefined()
  })
})
