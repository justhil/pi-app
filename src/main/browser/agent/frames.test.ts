import { describe, expect, it } from 'vitest'
import type { PageEngine } from '../engines/types'
import { matchOwners, nestUnder, scopeOf, withFrames } from './frames'

describe('nestUnder', () => {
  it('nests a frame snapshot under its iframe line', () => {
    expect(nestUnder('- main:\n  - iframe [ref=e5]\n  - button "x" [ref=e6]', 'e5', '- button "Pay" [ref=f1e2]')).toBe(
      '- main:\n  - iframe [ref=e5]:\n    - button "Pay" [ref=f1e2]\n  - button "x" [ref=e6]',
    )
  })
})

describe('matchOwners', () => {
  const owner = (o: Partial<{ ref: string; id: string; name: string; src: string }>) => ({ ref: 'e1', id: '', name: '', src: '', visible: true, ...o })
  it('pairs by id, then name, then src, then position', () => {
    const owners = [owner({ ref: 'e1', src: 'https://a.test/' }), owner({ ref: 'e2', name: 'pay' }), owner({ ref: 'e3', id: 'chat' }), owner({ ref: 'e4' })]
    const frame = (frameId: string, url = '', name = '') => ({ frameId, parentId: 'top', url, name })
    const m = matchOwners(
      [
        { frame: frame('A', 'https://a.test/'), attrs: null },
        { frame: frame('B', '', 'pay'), attrs: null },
        { frame: frame('C'), attrs: { id: 'chat' } },
        { frame: frame('D'), attrs: null },
      ],
      owners,
    )
    expect([...m].map(([f, o]) => `${f}:${o.ref}`)).toEqual(['A:e1', 'B:e2', 'C:e3', 'D:e4'])
  })
})

/** A page whose top document has one iframe (e5) holding a nested iframe (f1e3). */
function framedPage() {
  const frames = [
    { frameId: 'F1', parentId: 'TOP', url: 'https://pay.test/', name: '' },
    { frameId: 'F2', parentId: 'F1', url: 'https://inner.test/', name: '' },
  ]
  const own = (ref: string) => [{ ref, id: '', name: '', src: '', visible: true }]
  const cdp = {
    frames: async () => frames,
    frameOwner: async () => null,
    async runInFrame(frameId: string, expr: string) {
      if (expr.startsWith('__piBrowser.iframes()')) return frameId === 'F1' ? own('f1e3') : []
      if (expr.startsWith('__piBrowser.snapshot(')) {
        const prefix = JSON.parse(expr.slice('__piBrowser.snapshot('.length, -1)).refPrefix
        return { yaml: frameId === 'F1' ? `- iframe [ref=${prefix}e3]\n- button "Pay" [ref=${prefix}e4]` : `- button "Inner" [ref=${prefix}e1]` }
      }
      if (expr.startsWith('__piBrowser.frameOffset')) return { x: 5, y: 5, scale: 1 }
      return null
    },
  }
  const engine = {
    cdpTab: () => cdp,
    async run(expr: string) {
      if (expr.startsWith('__piBrowser.iframes()')) return own('e5')
      if (expr.startsWith('__piBrowser.frameOffset')) return { x: 100, y: 200, scale: 2 }
      return null
    },
  } as unknown as PageEngine
  return engine
}

describe('withFrames / scopeOf', () => {
  it('nests frame snapshots with stable prefixes and routes frame refs', async () => {
    const engine = framedPage()
    const yaml = await withFrames(engine, '- iframe [ref=e5]')
    expect(yaml).toBe('- iframe [ref=e5]:\n  - iframe [ref=f1e3]:\n    - button "Inner" [ref=f2e1]\n  - button "Pay" [ref=f1e4]')
    expect(await withFrames(engine, '- iframe [ref=e5]')).toBe(yaml)
    expect(scopeOf(engine, 'e5').frameId).toBeNull()
    expect(scopeOf(engine, 'f2e1').frameId).toBe('F2')
    // F2 point (10,10) → F1: 5+10 = 15 → top: 100 + 15*2 = 130, 200 + 15*2 = 230
    expect(await scopeOf(engine, 'f2e1').toTop({ x: 10, y: 10 })).toEqual({ x: 130, y: 230, scale: 2 })
    expect(() => scopeOf(engine, 'f9e1')).toThrow(/browser_stale_ref/)
  })
})
