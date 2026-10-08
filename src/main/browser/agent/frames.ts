// Snapshots and actions across frames (BrowserSkill: refs inside iframes and shadow roots).
// Each child frame runs its own page runtime with a ref prefix (`f2e14`); its snapshot is nested
// under the `- iframe [ref=…]` line of its parent, and actions on a prefixed ref are routed to
// that frame with its points translated to the top-level viewport.

import type { FrameInfo } from '../cdp/cdp-tab'
import type { PageEngine } from '../engines/types'
import { BrowserToolError, unwrap, type RuntimeError } from './errors'

const MAX_FRAMES = 10
const MAX_DEPTH = 3
const FRAME_SNAPSHOT_CHARS = 100_000
const FRAME_REF = /^(f\d+)e\d+$/

interface Route {
  frameId: string
  /** Prefix of the parent frame; null for the top document. */
  parent: string | null
  /** The <iframe> element's ref in the parent. */
  owner: string
}

interface TabFrames {
  /** Stable per frame: Playwright caches a ref on the element, prefix included. */
  prefixes: Map<string, string>
  routes: Map<string, Route>
}

const state = new WeakMap<PageEngine, TabFrames>()

function tabFrames(engine: PageEngine): TabFrames {
  let s = state.get(engine)
  if (!s) state.set(engine, (s = { prefixes: new Map(), routes: new Map() }))
  return s
}

const js = (v: unknown) => JSON.stringify(v)

type Owner = { ref: string | null; id: string; name: string; src: string; visible: boolean }

/** Nest `child` (already-indented-from-zero YAML) under the line carrying `[ref=owner]`. */
export function nestUnder(yaml: string, owner: string, child: string): string {
  const lines = yaml.split('\n')
  const i = lines.findIndex((l) => l.includes(`[ref=${owner}]`))
  if (i < 0 || !child.trim()) return yaml
  const pad = ' '.repeat(lines[i].length - lines[i].trimStart().length + 2)
  if (!lines[i].trimEnd().endsWith(':')) lines[i] = `${lines[i].trimEnd()}:`
  lines.splice(i + 1, 0, ...child.split('\n').map((l) => pad + l))
  return lines.join('\n')
}

/** Pair child frames with their <iframe> elements: id, then name, then src, then position. */
export function matchOwners(children: { frame: FrameInfo; attrs: Record<string, string> | null }[], owners: Owner[]): Map<string, Owner> {
  const out = new Map<string, Owner>()
  const free = new Set(owners)
  const take = (frameId: string, o: Owner | undefined) => {
    if (!o) return false
    out.set(frameId, o)
    free.delete(o)
    return true
  }
  for (const { frame, attrs } of children) {
    const pick = (fn: (o: Owner) => boolean) => [...free].find(fn)
    if (attrs?.id && take(frame.frameId, pick((o) => o.id === attrs.id))) continue
    const name = attrs?.name || frame.name
    if (name && take(frame.frameId, pick((o) => o.name === name))) continue
    if (take(frame.frameId, pick((o) => !!o.src && (o.src === frame.url || o.src === attrs?.src)))) continue
  }
  const restFrames = children.filter((c) => !out.has(c.frame.frameId))
  const restOwners = [...free]
  if (restFrames.length === restOwners.length) restFrames.forEach((c, i) => out.set(c.frame.frameId, restOwners[i]))
  return out
}

/**
 * The top document's snapshot with visible child frames nested in it. Without the DevTools
 * protocol (or without frames) the top snapshot is returned as is.
 */
export async function withFrames(engine: PageEngine, topYaml: string): Promise<string> {
  const cdp = engine.cdpTab()
  if (!cdp) return topYaml
  const frames = await cdp.frames().catch(() => [] as FrameInfo[])
  if (!frames.length) return topYaml
  const s = tabFrames(engine)
  s.routes.clear()
  const ids = new Set(frames.map((f) => f.frameId))
  const topId = frames.find((f) => f.parentId && !ids.has(f.parentId))?.parentId ?? null
  const yamlOf = new Map<string | null, string>([[null, topYaml]])
  const children = new Map<string | null, string[]>()
  let budget = MAX_FRAMES
  const visit = async (parentId: string | null, parentPrefix: string | null, depth: number) => {
    if (depth > MAX_DEPTH || budget <= 0) return
    const kids = frames.filter((f) => f.parentId === (parentId ?? topId))
    if (!kids.length) return
    const run = <T>(expr: string) => (parentId ? cdp.runInFrame<T>(parentId, expr) : engine.run<T>(expr))
    const owners = await run<Owner[]>('__piBrowser.iframes()').catch(() => [] as Owner[])
    const parentSession = parentId ? frames.find((f) => f.frameId === parentId)?.sessionId : undefined
    const described = await Promise.all(kids.map(async (frame) => ({ frame, attrs: await cdp.frameOwner(frame.frameId, parentSession) })))
    const matched = matchOwners(described, owners)
    for (const frame of kids) {
      const owner = matched.get(frame.frameId)
      if (!owner?.visible || !owner.ref || budget <= 0) continue
      budget--
      let prefix = s.prefixes.get(frame.frameId)
      if (!prefix) s.prefixes.set(frame.frameId, (prefix = `f${s.prefixes.size + 1}`))
      const snap = await cdp
        .runInFrame<{ yaml: string } | RuntimeError>(frame.frameId, `__piBrowser.snapshot(${js({ refPrefix: prefix, maxChars: FRAME_SNAPSHOT_CHARS })})`, 8000)
        .catch(() => null)
      if (!snap || 'error' in snap) continue
      s.routes.set(prefix, { frameId: frame.frameId, parent: parentPrefix, owner: owner.ref })
      yamlOf.set(frame.frameId, snap.yaml)
      const list = children.get(parentId) ?? []
      list.push(frame.frameId)
      children.set(parentId, list)
      await visit(frame.frameId, prefix, depth + 1)
    }
  }
  await visit(null, null, 1)
  const merge = (id: string | null): string => {
    let yaml = yamlOf.get(id) ?? ''
    for (const kid of children.get(id) ?? []) {
      const route = [...s.routes.values()].find((r) => r.frameId === kid)!
      yaml = nestUnder(yaml, route.owner, merge(kid))
    }
    return yaml
  }
  return merge(null)
}

export interface FrameScope {
  run<T>(expr: string, timeoutMs?: number): Promise<T>
  /** Scroll the frame's <iframe> (and its ancestors') into view: offscreen cross-origin frames
   * are throttled so hard that their timers barely run. No-op for the top document. */
  reveal(): Promise<void>
  /** Frame point → top-level viewport point (identity for the top document). */
  toTop(p: { x: number; y: number }): Promise<{ x: number; y: number; scale: number }>
  frameId: string | null
}

/** Where a target lives: the top document, or the frame its ref prefix names. */
export function scopeOf(engine: PageEngine, target: string | undefined): FrameScope {
  const prefix = target ? FRAME_REF.exec(target.trim())?.[1] : undefined
  if (!prefix) return { run: (e, t) => engine.run(e, t), reveal: async () => undefined, toTop: async (p) => ({ ...p, scale: 1 }), frameId: null }
  const cdp = engine.cdpTab()
  const s = tabFrames(engine)
  const route = s.routes.get(prefix)
  if (!cdp || !route) throw new BrowserToolError('browser_stale_ref', `${target} is from a frame that is gone or not in the latest snapshot; take a new snapshot`)
  const runIn = <T>(prefixOrTop: string | null, expr: string, t?: number) =>
    prefixOrTop ? cdp.runInFrame<T>(s.routes.get(prefixOrTop)!.frameId, expr, t) : engine.run<T>(expr, t)
  return {
    frameId: route.frameId,
    run: (expr, t) => cdp.runInFrame(route.frameId, expr, t),
    reveal: async () => {
      const chain: Route[] = []
      for (let r: Route | undefined = route; r; r = r.parent ? s.routes.get(r.parent) : undefined) chain.unshift(r)
      for (const r of chain) {
        await runIn(r.parent, `__piBrowser.actionable(${js(r.owner)}, ${js({ force: true, timeoutMs: 1500 })})`, 3000).catch(() => undefined)
      }
      // A frame that was offscreen (throttled) needs a few rendered frames before the browser
      // routes input to it; clicking at once lands on the parent's <iframe> instead.
      await runIn(null, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', 1000).catch(() => undefined)
      await new Promise((r) => setTimeout(r, 250))
    },
    toTop: async (p) => {
      let x = p.x
      let y = p.y
      let scale = 1
      for (let r: Route | undefined = route; r; r = r.parent ? s.routes.get(r.parent) : undefined) {
        const o = unwrap(await runIn<{ x: number; y: number; scale: number } | RuntimeError>(r.parent, `__piBrowser.frameOffset(${js(r.owner)})`))
        x = o.x + x * o.scale
        y = o.y + y * o.scale
        scale *= o.scale
      }
      return { x, y, scale }
    },
  }
}
