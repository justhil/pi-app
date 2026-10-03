import { describe, expect, it } from 'vitest'
import { assignSession, closePane, collapsedPanes, equalize, movePane, openPane, resizeAt, sanitizeLayout, singleLayout, type PaneSession } from './split-layout'

const s = (n: number): PaneSession => ({ sessionId: `id${n}`, sessionFile: `/s/${n}.jsonl`, workspace: '/w', title: `S${n}` })

describe('split layout', () => {
  it('opens panes to the right of the active one and focuses them', () => {
    let l = singleLayout(s(1), 'a')
    l = openPane(l, s(2), { id: 'b' })
    l = openPane(l, s(3), { anchorId: 'a', id: 'c' })
    expect(l.panes.map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(l.activePaneId).toBe('c')
    expect(l.sizes.map((x) => x.toFixed(3))).toEqual(['0.333', '0.333', '0.333'])
  })

  it('focuses the pane that already shows a session instead of duplicating it', () => {
    let l = openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' })
    l = openPane(l, s(1))
    expect(l.panes).toHaveLength(2)
    expect(l.activePaneId).toBe('a')
    expect(assignSession(l, 'b', s(1)).activePaneId).toBe('a')
  })

  it('stops at four panes', () => {
    let l = singleLayout(s(1))
    for (let i = 2; i <= 6; i++) l = openPane(l, s(i))
    expect(l.panes).toHaveLength(4)
  })

  it('closing never touches sessions and hands focus and width to a neighbour', () => {
    let l = openPane(openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' }), s(3), { id: 'c' })
    l = { ...l, sizes: [0.5, 0.3, 0.2] }
    const closed = closePane(l, 'c')
    expect(closed.panes.map((p) => p.id)).toEqual(['a', 'b'])
    expect(closed.activePaneId).toBe('b')
    expect(closed.sizes).toEqual([0.5, 0.5])
    expect(closePane(singleLayout(s(1), 'x'), 'x').panes).toHaveLength(1)
  })

  it('moves panes with their sizes', () => {
    let l = openPane(openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' }), s(3), { id: 'c' })
    l = { ...l, sizes: [0.5, 0.3, 0.2] }
    const m = movePane(l, 'a', 2)
    expect(m.panes.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(m.sizes).toEqual([0.3, 0.2, 0.5])
  })

  it('resizes a pair with snapping and a minimum', () => {
    const l = openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' })
    expect(resizeAt(l, 0, 0.51, 0.2).sizes).toEqual([0.5, 0.5])
    expect(resizeAt(l, 0, 0.65, 0.2).sizes[0]).toBeCloseTo(2 / 3)
    expect(resizeAt(l, 0, 0.02, 0.2).sizes[0]).toBeCloseTo(0.2)
    expect(equalize(resizeAt(l, 0, 0.8, 0.2)).sizes).toEqual([0.5, 0.5])
  })

  it('collapses far inactive panes first when the centre is too narrow', () => {
    const l = openPane(openPane(openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' }), s(3), { id: 'c' }), s(4), { id: 'd' })
    const active = { ...l, activePaneId: 'a' }
    expect([...collapsedPanes(active, 2000)]).toEqual([])
    expect([...collapsedPanes(active, 1000)]).toEqual(['d'])
    expect([...collapsedPanes(active, 800)].sort()).toEqual(['c', 'd'])
    expect([...collapsedPanes(active, 400)].sort()).toEqual(['b', 'c', 'd'])
  })

  it('sanitises restored layouts', () => {
    expect(sanitizeLayout(null)).toBeNull()
    const r = sanitizeLayout({ panes: [{ id: 'a', session: null }, { id: 'b', session: null }], sizes: [3, 1], activePaneId: 'zz' })!
    expect(r.sizes).toEqual([0.75, 0.25])
    expect(r.activePaneId).toBe('a')
  })
})
