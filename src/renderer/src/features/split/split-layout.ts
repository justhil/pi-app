// Pure split-layout model, tmux style: a binary tree of splits whose leaves are panes. A pane
// remembers one session; exactly one pane is active (it hosts the real timeline + composer of
// the focused session). Layout only — sessions and their workers are untouched by anything here.

export interface PaneSession {
  sessionId: string
  sessionFile: string
  workspace: string
  title: string
}

export interface Pane {
  id: string
  session: PaneSession | null
}

/** `row` places `a` left of `b`; `col` places `a` above `b`. `ratio` is `a`'s share. */
export type LayoutNode = { kind: 'pane'; pane: Pane } | { kind: 'split'; id: string; dir: 'row' | 'col'; ratio: number; a: LayoutNode; b: LayoutNode }

export interface SplitLayout {
  root: LayoutNode
  activePaneId: string
  /** Leaves of `root` in reading order (left→right, top→bottom); derived, kept for convenience. */
  panes: Pane[]
}

export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Preset = 'columns' | 'rows' | 'main-left' | 'main-top' | 'grid'

export const MAX_PANES = 4
export const MIN_PANE_PX = 320
export const MIN_PANE_H = 260
const SNAPS = [1 / 3, 1 / 2, 2 / 3]

let seq = 0
export const newPaneId = () => `pane-${Date.now().toString(36)}-${++seq}`
const newSplitId = () => `split-${Date.now().toString(36)}-${++seq}`

const leaf = (pane: Pane): LayoutNode => ({ kind: 'pane', pane })
const split = (dir: 'row' | 'col', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ kind: 'split', id: newSplitId(), dir, ratio, a, b })

export function leaves(node: LayoutNode): Pane[] {
  return node.kind === 'pane' ? [node.pane] : [...leaves(node.a), ...leaves(node.b)]
}

/** Rebuild the derived fields; the single place a layout is assembled. */
export function makeLayout(root: LayoutNode, activePaneId: string): SplitLayout {
  const panes = leaves(root)
  return { root, panes, activePaneId: panes.some((p) => p.id === activePaneId) ? activePaneId : panes[0].id }
}

export function singleLayout(session: PaneSession | null = null, id = newPaneId()): SplitLayout {
  return makeLayout(leaf({ id, session }), id)
}

const sameSession = (a: PaneSession | null, b: PaneSession | null) => !!a && !!b && a.sessionFile === b.sessionFile

function mapLeaves(node: LayoutNode, fn: (p: Pane) => Pane): LayoutNode {
  return node.kind === 'pane' ? leaf(fn(node.pane)) : { ...node, a: mapLeaves(node.a, fn), b: mapLeaves(node.b, fn) }
}

/** Replace the leaf `paneId` with whatever `fn` returns for it. */
function replaceLeaf(node: LayoutNode, paneId: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (node.kind === 'pane') return node.pane.id === paneId ? fn(node) : node
  return { ...node, a: replaceLeaf(node.a, paneId, fn), b: replaceLeaf(node.b, paneId, fn) }
}

/** The tree without `paneId`: its parent split collapses into the sibling. */
function removeLeaf(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === 'pane') return node.pane.id === paneId ? null : node
  const a = removeLeaf(node.a, paneId)
  const b = removeLeaf(node.b, paneId)
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

const dirOf = (side: Side) => (side === 'left' || side === 'right' ? 'row' : 'col')
const before = (side: Side) => side === 'left' || side === 'top'

/** Split the leaf `anchorId` and put `node` on `side` of it. */
function insertAt(root: LayoutNode, anchorId: string, side: Side, node: LayoutNode): LayoutNode {
  return replaceLeaf(root, anchorId, (anchor) => (before(side) ? split(dirOf(side), node, anchor) : split(dirOf(side), anchor, node)))
}

/**
 * Open `session` in a new pane on `side` of `anchorId` (right of the active pane by default), or
 * focus the pane that already shows it. Returns the layout unchanged at the pane limit.
 */
export function openPane(layout: SplitLayout, session: PaneSession | null, opts: { anchorId?: string; side?: Side; id?: string } = {}): SplitLayout {
  const existing = session && layout.panes.find((p) => sameSession(p.session, session))
  if (existing) return { ...layout, activePaneId: existing.id }
  if (layout.panes.length >= MAX_PANES) return layout
  const anchorId = layout.panes.some((p) => p.id === opts.anchorId) ? opts.anchorId! : layout.activePaneId
  const pane: Pane = { id: opts.id ?? newPaneId(), session }
  return makeLayout(insertAt(layout.root, anchorId, opts.side ?? 'right', leaf(pane)), pane.id)
}

/** Close a pane (never the session). The pane that takes its space becomes active when it was. */
export function closePane(layout: SplitLayout, paneId: string): SplitLayout {
  if (layout.panes.length === 1 || !layout.panes.some((p) => p.id === paneId)) return layout
  const i = layout.panes.findIndex((p) => p.id === paneId)
  const root = removeLeaf(layout.root, paneId)!
  const rest = leaves(root)
  const activePaneId = layout.activePaneId === paneId ? rest[Math.max(0, i - 1)].id : layout.activePaneId
  return makeLayout(root, activePaneId)
}

/** Put `session` in a pane (e.g. the sidebar opened a session in the active pane). */
export function assignSession(layout: SplitLayout, paneId: string, session: PaneSession | null): SplitLayout {
  // A session lives in one pane at a time: opening it where it already is just focuses it.
  const other = session && layout.panes.find((p) => p.id !== paneId && sameSession(p.session, session))
  if (other) return { ...layout, activePaneId: other.id }
  return makeLayout(
    mapLeaves(layout.root, (p) => (p.id === paneId ? { ...p, session } : p)),
    layout.activePaneId,
  )
}

export function setActivePane(layout: SplitLayout, paneId: string): SplitLayout {
  return layout.panes.some((p) => p.id === paneId) ? { ...layout, activePaneId: paneId } : layout
}

/** Drag a pane onto another: `center` swaps the two, a side moves it next to the target. */
export function dropPane(layout: SplitLayout, paneId: string, targetId: string, where: Side | 'center'): SplitLayout {
  if (paneId === targetId) return layout
  const moving = layout.panes.find((p) => p.id === paneId)
  const target = layout.panes.find((p) => p.id === targetId)
  if (!moving || !target) return layout
  if (where === 'center') {
    return makeLayout(
      mapLeaves(layout.root, (p) => (p.id === paneId ? target : p.id === targetId ? moving : p)),
      layout.activePaneId,
    )
  }
  const without = removeLeaf(layout.root, paneId)
  if (!without) return layout
  return makeLayout(insertAt(without, targetId, where, leaf(moving)), layout.activePaneId)
}

/** Ratio of split `splitId`, snapped near 1/3, 1/2, 2/3 and kept above `minFraction` on both sides. */
export function resizeSplit(layout: SplitLayout, splitId: string, ratio: number, minFraction: number): SplitLayout {
  let r = ratio
  for (const snap of SNAPS) if (Math.abs(r - snap) < 0.025) r = snap
  const lo = Math.min(0.5, Math.max(0.05, minFraction))
  r = Math.max(lo, Math.min(1 - lo, r))
  const walk = (n: LayoutNode): LayoutNode => (n.kind === 'pane' ? n : n.id === splitId ? { ...n, ratio: r } : { ...n, a: walk(n.a), b: walk(n.b) })
  return { ...layout, root: walk(layout.root) }
}

/** The snap a ratio lands on, for the resize guide (undefined between snaps). */
export function snapOf(ratio: number): number | undefined {
  return SNAPS.find((s) => Math.abs(ratio - s) < 0.001)
}

/** Every split sized by how many panes each side holds along its direction, so panes get equal room. */
export function equalize(layout: SplitLayout): SplitLayout {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === 'pane') return n
    const along = (x: LayoutNode): number => (x.kind === 'split' && x.dir === n.dir ? along(x.a) + along(x.b) : 1)
    return { ...n, ratio: along(n.a) / (along(n.a) + along(n.b)), a: walk(n.a), b: walk(n.b) }
  }
  return { ...layout, root: walk(layout.root) }
}

/** Presets offered for a pane count (tmux: even-horizontal, even-vertical, main-vertical, main-horizontal, tiled). */
export function presetsFor(count: number): Preset[] {
  if (count <= 1) return []
  if (count === 2) return ['columns', 'rows']
  if (count === 3) return ['columns', 'rows', 'main-left', 'main-top']
  return ['columns', 'rows', 'main-left', 'main-top', 'grid']
}

function chain(dir: 'row' | 'col', nodes: LayoutNode[]): LayoutNode {
  if (nodes.length === 1) return nodes[0]
  const [first, ...rest] = nodes
  return split(dir, first, chain(dir, rest), 1 / nodes.length)
}

/** Re-arrange the current panes (in reading order, active first for "main" presets) into a preset. */
export function applyPreset(layout: SplitLayout, preset: Preset): SplitLayout {
  const panes = layout.panes
  if (panes.length < 2) return layout
  const nodes = panes.map(leaf)
  const active = panes.findIndex((p) => p.id === layout.activePaneId)
  const mainFirst = [nodes[active], ...nodes.filter((_, i) => i !== active)]
  let root: LayoutNode
  switch (preset) {
    case 'columns':
      root = chain('row', nodes)
      break
    case 'rows':
      root = chain('col', nodes)
      break
    case 'main-left':
      root = split('row', mainFirst[0], chain('col', mainFirst.slice(1)), 0.6)
      break
    case 'main-top':
      root = split('col', mainFirst[0], chain('row', mainFirst.slice(1)), 0.6)
      break
    case 'grid': {
      const top = nodes.slice(0, Math.ceil(nodes.length / 2))
      const bottom = nodes.slice(top.length)
      root = bottom.length ? split('col', chain('row', top), chain('row', bottom)) : chain('row', top)
      break
    }
  }
  return makeLayout(root, layout.activePaneId)
}

export interface PaneRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** Pixel rectangles of every pane for a container size (handles take `gap` px). */
export function paneRects(root: LayoutNode, w: number, h: number, gap = 6): PaneRect[] {
  const out: PaneRect[] = []
  const walk = (n: LayoutNode, x: number, y: number, ww: number, hh: number) => {
    if (n.kind === 'pane') return void out.push({ id: n.pane.id, x, y, w: ww, h: hh })
    if (n.dir === 'row') {
      const aw = Math.max(0, (ww - gap) * n.ratio)
      walk(n.a, x, y, aw, hh)
      walk(n.b, x + aw + gap, y, Math.max(0, ww - gap - aw), hh)
    } else {
      const ah = Math.max(0, (hh - gap) * n.ratio)
      walk(n.a, x, y, ww, ah)
      walk(n.b, x, y + ah + gap, ww, Math.max(0, hh - gap - ah))
    }
  }
  walk(root, 0, 0, w, h)
  return out
}

export interface HandleRect {
  splitId: string
  dir: 'row' | 'col'
  /** The gap between the two sides (where the handle sits). */
  x: number
  y: number
  w: number
  h: number
  /** The split's whole area, to turn a pointer position into a ratio. */
  area: { x: number; y: number; w: number; h: number }
  ratio: number
}

/** Pixel rectangles of every split's handle, matching `paneRects`. */
export function handleRects(root: LayoutNode, w: number, h: number, gap = 6): HandleRect[] {
  const out: HandleRect[] = []
  const walk = (n: LayoutNode, x: number, y: number, ww: number, hh: number) => {
    if (n.kind === 'pane') return
    if (n.dir === 'row') {
      const aw = Math.max(0, (ww - gap) * n.ratio)
      out.push({ splitId: n.id, dir: 'row', x: x + aw, y, w: gap, h: hh, area: { x, y, w: ww, h: hh }, ratio: n.ratio })
      walk(n.a, x, y, aw, hh)
      walk(n.b, x + aw + gap, y, Math.max(0, ww - gap - aw), hh)
    } else {
      const ah = Math.max(0, (hh - gap) * n.ratio)
      out.push({ splitId: n.id, dir: 'col', x, y: y + ah, w: ww, h: gap, area: { x, y, w: ww, h: hh }, ratio: n.ratio })
      walk(n.a, x, y, ww, ah)
      walk(n.b, x, y + ah + gap, ww, Math.max(0, hh - gap - ah))
    }
  }
  walk(root, 0, 0, w, h)
  return out
}

/** Too little room for the active pane: show it alone with the others as tabs (focus mode). */
export function needsFocusMode(layout: SplitLayout, w: number, h: number): boolean {
  if (layout.panes.length < 2 || w <= 0 || h <= 0) return false
  const active = paneRects(layout.root, w, h).find((r) => r.id === layout.activePaneId)
  return !active || active.w < Math.min(MIN_PANE_PX, w) || active.h < Math.min(MIN_PANE_H, h)
}

/** The pane next to the active one in a direction, by geometry (keyboard navigation). */
export function neighbour(layout: SplitLayout, dir: Side): string | null {
  const rects = paneRects(layout.root, 1000, 1000, 0)
  const cur = rects.find((r) => r.id === layout.activePaneId)
  if (!cur) return null
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2
  const candidates = rects.filter((r) =>
    dir === 'left' ? r.x + r.w <= cur.x + 0.5 : dir === 'right' ? r.x >= cur.x + cur.w - 0.5 : dir === 'top' ? r.y + r.h <= cur.y + 0.5 : r.y >= cur.y + cur.h - 0.5,
  )
  const dist = (r: PaneRect) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy)
  return candidates.sort((a, b) => dist(a) - dist(b))[0]?.id ?? null
}

function validNode(raw: unknown, seen: Set<string>): LayoutNode | null {
  const n = raw as LayoutNode | null
  if (!n || typeof n !== 'object') return null
  if (n.kind === 'pane') {
    const p = n.pane
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) return null
    seen.add(p.id)
    return leaf({ id: p.id, session: p.session && typeof p.session.sessionFile === 'string' ? p.session : null })
  }
  if (n.kind === 'split') {
    const a = validNode(n.a, seen)
    const b = validNode(n.b, seen)
    if (!a || !b) return a ?? b
    const ratio = Number.isFinite(n.ratio) ? Math.min(0.95, Math.max(0.05, n.ratio)) : 0.5
    return { kind: 'split', id: typeof n.id === 'string' ? n.id : newSplitId(), dir: n.dir === 'col' ? 'col' : 'row', ratio, a, b }
  }
  return null
}

/** Restored layouts must stay valid; the v1 shape (a row of panes with sizes) is migrated. */
export function sanitizeLayout(raw: unknown): SplitLayout | null {
  const l = raw as { root?: unknown; panes?: Pane[]; sizes?: number[]; activePaneId?: string } | null
  if (!l) return null
  let root = l.root ? validNode(l.root, new Set()) : null
  if (!root && Array.isArray(l.panes) && l.panes.length) {
    const panes = l.panes.filter((p) => p && typeof p.id === 'string').slice(0, MAX_PANES)
    if (panes.length) root = chain('row', panes.map((p) => leaf({ id: p.id, session: p.session ?? null })))
  }
  if (!root) return null
  while (leaves(root).length > MAX_PANES) root = removeLeaf(root, leaves(root).at(-1)!.id)!
  return makeLayout(root, String(l.activePaneId ?? ''))
}
