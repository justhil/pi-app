import { describe, expect, it } from 'vitest'
import { compactSnapshot, diffSnapshots } from './snapshot-diff'

describe('diffSnapshots', () => {
  it('returns null when nothing changed', () => {
    const s = '- main:\n  - button "Save" [ref=e2]'
    expect(diffSnapshots(s, `${s}\n`)).toBeNull()
  })

  it('lists removed then added lines without the list dash', () => {
    const prev = '- main:\n  - checkbox "Remember me" [ref=e3]\n  - button "Save" [ref=e4]'
    const next = '- main:\n  - checkbox "Remember me" [checked] [ref=e3]\n  - button "Save" [ref=e4]\n  - text: Saved'
    expect(diffSnapshots(prev, next)).toBe('- checkbox "Remember me" [ref=e3]\n+ checkbox "Remember me" [checked] [ref=e3]\n+ text: Saved')
  })

  it('counts repeated lines', () => {
    expect(diffSnapshots('- listitem: a\n- listitem: a\n- listitem: a', '- listitem: a\n- listitem: a')).toBe('- listitem: a')
  })

  it('caps long diffs', () => {
    const next = Array.from({ length: 50 }, (_, i) => `- listitem: ${i}`).join('\n')
    const out = diffSnapshots('', next, 10)!
    expect(out.split('\n')).toHaveLength(11)
    expect(out).toMatch(/40 more changed lines/)
  })
})

describe('compactSnapshot', () => {
  it('keeps headings and ref lines with indentation', () => {
    const yaml = '- banner [ref=e1]:\n  - heading "Shop" [level=1] [ref=e2]\n  - paragraph [ref=e3]: welcome\n  - link "Cart" [ref=e5]\n  - generic [ref=e6] [cursor=pointer]: Menu'
    expect(compactSnapshot(yaml)).toBe('  - heading "Shop" [level=1] [ref=e2]\n  - link "Cart" [ref=e5]\n  - generic [ref=e6] [cursor=pointer]: Menu')
  })

  it('stops at the budget', () => {
    const yaml = Array.from({ length: 100 }, (_, i) => `- link "Item ${i}" [ref=e${i}]`).join('\n')
    const out = compactSnapshot(yaml, 200)
    expect(out.length).toBeLessThan(260)
    expect(out).toMatch(/more; call browser_snapshot/)
  })
})
