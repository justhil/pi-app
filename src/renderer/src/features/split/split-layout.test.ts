import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  assignSession,
  closePane,
  dropPane,
  equalize,
  needsFocusMode,
  neighbour,
  openPane,
  paneRects,
  presetsFor,
  resizeSplit,
  sanitizeLayout,
  singleLayout,
  type LayoutNode,
  type PaneSession,
  type SplitLayout,
} from './split-layout'

const s = (n: number): PaneSession => ({ sessionId: `id${n}`, sessionFile: `/s/${n}.jsonl`, workspace: '/w', title: `S${n}` })
const ids = (l: SplitLayout) => l.panes.map((p) => p.id)
/** Compact picture of the tree: row(a,b) / col(a,b). */
const shape = (n: LayoutNode): string => (n.kind === 'pane' ? n.pane.id : `${n.dir}(${shape(n.a)},${shape(n.b)})`)
const rect = (l: SplitLayout, id: string) => paneRects(l.root, 1000, 800, 0).find((r) => r.id === id)!

describe('split layout tree', () => {
  it('splits the anchor pane on any side and focuses the new pane', () => {
    let l = singleLayout(s(1), 'a')
    l = openPane(l, s(2), { id: 'b' })
    l = openPane(l, s(3), { anchorId: 'b', side: 'bottom', id: 'c' })
    l = openPane(l, s(4), { anchorId: 'a', side: 'top', id: 'd' })
    expect(shape(l.root)).toBe('row(col(d,a),col(b,c))')
    expect(ids(l)).toEqual(['d', 'a', 'b', 'c'])
    expect(l.activePaneId).toBe('d')
    expect(rect(l, 'c')).toMatchObject({ x: 500, y: 400, w: 500, h: 400 })
  })

  it('focuses the pane that already shows a session and stops at four panes', () => {
    let l = openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' })
    expect(openPane(l, s(1)).activePaneId).toBe('a')
    expect(assignSession(l, 'b', s(1)).activePaneId).toBe('a')
    for (let i = 3; i <= 6; i++) l = openPane(l, s(i))
    expect(l.panes).toHaveLength(4)
  })

  it('closing collapses the parent split into the sibling and keeps sessions', () => {
    let l = openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' })
    l = openPane(l, s(3), { anchorId: 'b', side: 'bottom', id: 'c' })
    const closed = closePane(l, 'c')
    expect(shape(closed.root)).toBe('row(a,b)')
    expect(closed.activePaneId).toBe('b')
    expect(closePane(singleLayout(s(1), 'x'), 'x').panes).toHaveLength(1)
  })

  it('drops a pane beside another or swaps the two', () => {
    const l = openPane(openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' }), s(3), { id: 'c' })
    expect(shape(l.root)).toBe('row(a,row(b,c))')
    const moved = dropPane(l, 'c', 'a', 'top')
    expect(shape(moved.root)).toBe('row(col(c,a),b)')
    const swapped = dropPane(l, 'a', 'c', 'center')
    expect(ids(swapped)).toEqual(['c', 'b', 'a'])
    expect(dropPane(l, 'a', 'a', 'left')).toBe(l)
  })

  it('resizes a split with snapping and limits, and equalizes along each direction', () => {
    let l = openPane(singleLayout(s(1), 'a'), s(2), { id: 'b' })
    const id = (l.root as { id: string }).id
    expect((resizeSplit(l, id, 0.34, 0.1).root as { ratio: number }).ratio).toBeCloseTo(1 / 3)
    expect((resizeSplit(l, id, 0.95, 0.2).root as { ratio: number }).ratio).toBe(0.8)
    l = openPane(l, s(3), { anchorId: 'b', id: 'c' })
    const eq = equalize(l)
    expect(rect(eq, 'a').w).toBeCloseTo(1000 / 3)
    expect(rect(eq, 'c').w).toBeCloseTo(1000 / 3)
  })

  it('applies presets to the current panes', () => {
    let l = singleLayout(s(1), 'a')
    for (const [n, id] of [[2, 'b'], [3, 'c'], [4, 'd']] as const) l = openPane(l, s(n), { id })
    expect(presetsFor(2)).toEqual(['columns', 'rows'])
    expect(presetsFor(4)).toContain('grid')
    expect(shape(applyPreset(l, 'grid').root)).toBe('col(row(a,b),row(c,d))')
    const main = applyPreset({ ...l, activePaneId: 'c' }, 'main-left')
    expect(shape(main.root)).toBe('row(c,col(a,col(b,d)))')
    expect(rect(main, 'c').w).toBeCloseTo(600)
  })

  it('switches to focus mode when the active pane gets too small', () => {
    let l = singleLayout(s(1), 'a')
    for (const [n, id] of [[2, 'b'], [3, 'c'], [4, 'd']] as const) l = openPane(l, s(n), { id })
    l = applyPreset(l, 'grid')
    expect(needsFocusMode(l, 1400, 900)).toBe(false)
    expect(needsFocusMode(l, 600, 900)).toBe(true)
    expect(needsFocusMode(l, 1400, 400)).toBe(true)
  })

  it('finds neighbours by geometry', () => {
    let l = singleLayout(s(1), 'a')
    for (const [n, id] of [[2, 'b'], [3, 'c'], [4, 'd']] as const) l = openPane(l, s(n), { id })
    l = { ...applyPreset(l, 'grid'), activePaneId: 'a' }
    expect(neighbour(l, 'right')).toBe('b')
    expect(neighbour(l, 'bottom')).toBe('c')
    expect(neighbour(l, 'left')).toBeNull()
  })

  it('restores saved trees and migrates the old row layout', () => {
    const l = openPane(singleLayout(s(1), 'a'), s(2), { anchorId: 'a', side: 'bottom', id: 'b' })
    expect(shape(sanitizeLayout(JSON.parse(JSON.stringify(l)))!.root)).toBe('col(a,b)')
    const old = sanitizeLayout({ panes: [{ id: 'x', session: s(1) }, { id: 'y', session: null }], sizes: [0.5, 0.5], activePaneId: 'y' })!
    expect(shape(old.root)).toBe('row(x,y)')
    expect(old.activePaneId).toBe('y')
    expect(sanitizeLayout(null)).toBeNull()
  })
})
