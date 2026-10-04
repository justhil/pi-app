// Pure split-layout reducer. A pane remembers one session; exactly one pane is active (it
// hosts the real timeline + composer of the focused session). Layout only — sessions and
// their workers are untouched by anything here.

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

export interface SplitLayout {
  panes: Pane[]
  /** Fractions of the centre width, one per pane, summing to 1. */
  sizes: number[]
  activePaneId: string
}

export const MAX_PANES = 4
export const MIN_PANE_PX = 320
const SNAPS = [1 / 3, 1 / 2, 2 / 3]

let seq = 0
export const newPaneId = () => `pane-${Date.now().toString(36)}-${++seq}`

export function singleLayout(session: PaneSession | null = null, id = newPaneId()): SplitLayout {
  return { panes: [{ id, session }], sizes: [1], activePaneId: id }
}

const even = (n: number) => Array.from({ length: n }, () => 1 / n)

const sameSession = (a: PaneSession | null, b: PaneSession | null) => !!a && !!b && a.sessionFile === b.sessionFile

/**
 * Open `session` in a new pane next to `anchorId` (side 'right' by default), or focus the
 * pane that already shows it. Returns the layout unchanged at the pane limit.
 */
export function openPane(layout: SplitLayout, session: PaneSession | null, opts: { anchorId?: string; side?: 'left' | 'right'; id?: string } = {}): SplitLayout {
  const existing = session && layout.panes.find((p) => sameSession(p.session, session))
  if (existing) return { ...layout, activePaneId: existing.id }
  if (layout.panes.length >= MAX_PANES) return layout
  const anchor = Math.max(0, layout.panes.findIndex((p) => p.id === (opts.anchorId ?? layout.activePaneId)))
  const at = opts.side === 'left' ? anchor : anchor + 1
  const pane: Pane = { id: opts.id ?? newPaneId(), session }
  const panes = [...layout.panes.slice(0, at), pane, ...layout.panes.slice(at)]
  return { panes, sizes: even(panes.length), activePaneId: pane.id }
}

/** Close a pane (never the session). The neighbour becomes active when it was active. */
export function closePane(layout: SplitLayout, paneId: string): SplitLayout {
  const i = layout.panes.findIndex((p) => p.id === paneId)
  if (i < 0 || layout.panes.length === 1) return layout
  const panes = layout.panes.filter((p) => p.id !== paneId)
  const removed = layout.sizes[i] ?? 0
  const sizes = layout.sizes.filter((_, k) => k !== i)
  // Give the freed width to the neighbour that took its place.
  const into = Math.min(i, sizes.length - 1)
  sizes[into] += removed
  const activePaneId = layout.activePaneId === paneId ? panes[Math.max(0, i - 1)].id : layout.activePaneId
  return { panes, sizes, activePaneId }
}

/** Put `session` in a pane (e.g. the sidebar opened a session in the active pane). */
export function assignSession(layout: SplitLayout, paneId: string, session: PaneSession | null): SplitLayout {
  // A session lives in one pane at a time: opening it where it already is just focuses it.
  const other = session && layout.panes.find((p) => p.id !== paneId && sameSession(p.session, session))
  if (other) return { ...layout, activePaneId: other.id }
  return { ...layout, panes: layout.panes.map((p) => (p.id === paneId ? { ...p, session } : p)) }
}

export function setActivePane(layout: SplitLayout, paneId: string): SplitLayout {
  return layout.panes.some((p) => p.id === paneId) ? { ...layout, activePaneId: paneId } : layout
}

/** Move a pane to a new index (drag the pane header). Sizes travel with their pane. */
export function movePane(layout: SplitLayout, paneId: string, toIndex: number): SplitLayout {
  const from = layout.panes.findIndex((p) => p.id === paneId)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(layout.panes.length - 1, toIndex))
  if (from === to) return layout
  const panes = [...layout.panes]
  const sizes = [...layout.sizes]
  const [p] = panes.splice(from, 1)
  const [s] = sizes.splice(from, 1)
  panes.splice(to, 0, p)
  sizes.splice(to, 0, s)
  return { ...layout, panes, sizes }
}

/**
 * Drag the handle between pane `i` and `i + 1` so the pair splits at `fraction` of their
 * combined width; snaps near 1/3, 1/2, 2/3 and keeps both above `minFraction` of the centre.
 */
export function resizeAt(layout: SplitLayout, i: number, fraction: number, minFraction: number): SplitLayout {
  if (i < 0 || i >= layout.sizes.length - 1) return layout
  const pair = layout.sizes[i] + layout.sizes[i + 1]
  let f = fraction
  for (const snap of SNAPS) if (Math.abs(f - snap) < 0.03) f = snap
  const lo = Math.min(0.5, minFraction / pair)
  f = Math.max(lo, Math.min(1 - lo, f))
  const sizes = [...layout.sizes]
  sizes[i] = pair * f
  sizes[i + 1] = pair * (1 - f)
  return { ...layout, sizes }
}

export function equalize(layout: SplitLayout): SplitLayout {
  return { ...layout, sizes: even(layout.panes.length) }
}

/** Which panes get their full width at `centerPx`; the rest collapse to strips (active never). */
export function collapsedPanes(layout: SplitLayout, centerPx: number, stripPx = 36, gapPx = 6): Set<string> {
  const out = new Set<string>()
  // Resize handles sit between panes and take width too.
  const gaps = (layout.panes.length - 1) * gapPx
  const fits = (n: number) => (layout.panes.length - n) * MIN_PANE_PX + n * stripPx + gaps <= centerPx
  // Collapse inactive panes from the far end until the rest fits.
  const order = layout.panes
    .map((p, i) => ({ p, d: Math.abs(i - layout.panes.findIndex((x) => x.id === layout.activePaneId)) }))
    .filter(({ p }) => p.id !== layout.activePaneId)
    .sort((a, b) => b.d - a.d)
  for (const { p } of order) {
    if (fits(out.size)) break
    out.add(p.id)
  }
  return out
}

/** Restored layouts must stay valid: sizes normalised, active pane present. */
export function sanitizeLayout(raw: unknown): SplitLayout | null {
  const l = raw as SplitLayout | null
  if (!l || !Array.isArray(l.panes) || l.panes.length === 0) return null
  const panes = l.panes.slice(0, MAX_PANES).filter((p) => p && typeof p.id === 'string')
  if (!panes.length) return null
  let sizes = Array.isArray(l.sizes) && l.sizes.length === panes.length ? l.sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0)) : even(panes.length)
  const sum = sizes.reduce((a, b) => a + b, 0)
  sizes = sum > 0 ? sizes.map((s) => s / sum) : even(panes.length)
  const activePaneId = panes.some((p) => p.id === l.activePaneId) ? l.activePaneId : panes[0].id
  return { panes, sizes, activePaneId }
}
