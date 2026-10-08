// Shapes a raw ARIA snapshot (Playwright YAML) for the model: fewer tokens, same meaning.
// Pure string/tree work so it is testable in node and engine-agnostic. The raw snapshot is
// still what diffs compare against; refs hidden or folded here stay valid in the page runtime.
//
// Ideas from GenericAgent's simphtml (list folding, proportional truncation, long-URL
// shortening) applied to ARIA lines instead of HTML.

export interface ShapeNode {
  /** The line without indentation, e.g. `- link "Home" [ref=e3]:`. */
  text: string
  children: ShapeNode[]
  /** Continuation lines of a multi-line value, kept verbatim (relative indent included). */
  extra?: string[]
}

export interface ShapeOptions {
  /** Page origin, so same-origin links show only their path. */
  origin?: string
  /** Keep items/lines mentioning this text when folding or cutting. */
  focus?: string
  /** Fold repeated siblings (off when the model asked for one region). */
  fold?: boolean
  budget?: number
}

export interface ShapeResult {
  yaml: string
  truncated: boolean
  folded: number
}

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem'])
/** Containers worth a visible ref: the model scopes snapshots to them with target=<ref>. */
const REGIONS = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'region', 'form', 'search', 'dialog', 'alertdialog', 'article', 'list', 'table', 'grid', 'treegrid', 'tree', 'menu', 'menubar', 'tablist', 'tabpanel', 'listbox', 'radiogroup', 'toolbar', 'iframe', 'heading', 'alert', 'status'])
const TRACKING = /^(utm_\w+|spm|scm|fbclid|gclid|dclid|msclkid|yclid|mc_[ce]id|igshid|ref_src|ref_url|_hsenc|_hsmi|vero_\w+|from|share_source|share_medium|track\w*)$/i
const NAME_MAX = 100
const NAME_KEEP = 80
const URL_MAX = 100
const QUERY_MAX = 40
const FOLD_MIN_RUN = 6
/** Groups of 2–4 siblings repeat less often before they are clearly a list. */
const FOLD_MIN_GROUPS = 5
const MAX_PERIOD = 4
const FOLD_KEEP = 3
const FOLD_FOCUS_KEEP = 6
/** A run shorter than this is cheaper to show than to summarize. */
const FOLD_MIN_CHARS = 1200
const FOLD_NAMES_CHARS = 400
const DESCEND = 4000

// ── parse / render ─────────────────────────────────────────────────────────

export function parseYaml(yaml: string): ShapeNode[] {
  const roots: ShapeNode[] = []
  const stack: { indent: number; node: ShapeNode }[] = []
  let last: ShapeNode | null = null
  let lastIndent = 0
  for (const raw of yaml.split('\n')) {
    if (!raw.trim()) continue
    const indent = raw.length - raw.trimStart().length
    const body = raw.slice(indent)
    if (!body.startsWith('- ') && body !== '-') {
      // Block scalar continuation: belongs to the previous entry.
      if (last) (last.extra ??= []).push(' '.repeat(Math.max(0, indent - lastIndent)) + body)
      continue
    }
    const node: ShapeNode = { text: body, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ indent, node })
    last = node
    lastIndent = indent
  }
  return roots
}

export function renderYaml(nodes: ShapeNode[], depth = 0): string {
  const out: string[] = []
  const visit = (n: ShapeNode, d: number) => {
    const pad = '  '.repeat(d)
    out.push(pad + n.text)
    if (n.extra) for (const e of n.extra) out.push(pad + e)
    for (const c of n.children) visit(c, d + 1)
  }
  for (const n of nodes) visit(n, depth)
  return out.join('\n')
}

function nodeSize(n: ShapeNode, depth: number): number {
  let s = depth * 2 + n.text.length + 1
  if (n.extra) for (const e of n.extra) s += depth * 2 + e.length + 1
  for (const c of n.children) s += nodeSize(c, depth + 1)
  return s
}

// ── line anatomy ───────────────────────────────────────────────────────────

interface Line {
  role: string
  name?: string
  attrs: string[]
  colon: boolean
  value?: string
}

const LINE_RE = /^- ([A-Za-z][\w-]*|\/[\w-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)(:)?(?: (.*))?$/

/** Null for lines we do not understand (YAML-quoted keys etc.); those are left untouched. */
export function parseLine(text: string): Line | null {
  const m = LINE_RE.exec(text)
  if (!m) return null
  const attrs = m[3] ? (m[3].match(/\[[^\]]*\]/g) ?? []) : []
  return { role: m[1], name: m[2], attrs, colon: !!m[4], value: m[5] }
}

function formatLine(l: Line): string {
  return `- ${l.role}${l.name !== undefined ? ` "${l.name}"` : ''}${l.attrs.map((a) => ` ${a}`).join('')}${l.colon ? ':' : ''}${l.value !== undefined ? ` ${l.value}` : ''}`
}

const refOf = (text: string) => /\[ref=((?:f\d+)?e\d+)\]/.exec(text)?.[1]
const roleOf = (text: string) => parseLine(text)?.role ?? /^-\s+'?([\w/-]+)/.exec(text)?.[1] ?? ''

// ── slim ───────────────────────────────────────────────────────────────────

export function shortUrl(raw: string, origin?: string): string {
  const v = raw.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (v.startsWith('data:')) return 'data:…'
  if (v.startsWith('javascript:')) return 'javascript:…'
  let u: URL
  try {
    u = new URL(v, origin || undefined)
  } catch {
    return v.length > URL_MAX ? `${v.slice(0, URL_MAX)}…` : v
  }
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
  let query = u.searchParams.toString()
  if (query.length > QUERY_MAX) query = '…'
  const sameOrigin = !!origin && u.origin === safeOrigin(origin)
  let out = (sameOrigin ? '' : `${u.protocol}//${u.host}`) + u.pathname + (query ? `?${query}` : '') + (u.hash.length > 1 && u.hash.length < 30 ? u.hash : '')
  if (!sameOrigin && !/^https?:$/.test(u.protocol)) out = v
  if (out.length > URL_MAX) out = `${out.slice(0, URL_MAX)}…`
  return out
}

function safeOrigin(origin: string): string {
  try {
    return new URL(origin).origin
  } catch {
    return origin
  }
}

/**
 * Token diet, all display-only: short URLs, capped names, no pointer hint on things that are
 * clickable anyway, no unnamed decorative images, no single-child wrapper generics, refs shown
 * only where the model acts or scopes.
 */
export function slim(nodes: ShapeNode[], origin?: string): ShapeNode[] {
  const out: ShapeNode[] = []
  for (const n of nodes) {
    const l = parseLine(n.text)
    const children = slim(n.children, origin)
    if (!l) {
      out.push({ ...n, children })
      continue
    }
    if (l.role === '/url' && l.value !== undefined) {
      out.push({ text: formatLine({ ...l, value: shortUrl(l.value, origin) }), children })
      continue
    }
    const pointer = l.attrs.includes('[cursor=pointer]')
    const interactive = INTERACTIVE.has(l.role)
    // Wrapper generic with one child and nothing of its own: lift the child.
    if (l.role === 'generic' && l.name === undefined && l.value === undefined && !pointer && !n.extra && children.length === 1 && l.attrs.every((a) => a.startsWith('[ref='))) {
      out.push(children[0])
      continue
    }
    if (l.role === 'img' && !l.name && !l.value && !pointer && children.length === 0) continue
    let attrs = l.attrs
    if (interactive) attrs = attrs.filter((a) => a !== '[cursor=pointer]')
    if (!interactive && !pointer && !REGIONS.has(l.role)) attrs = attrs.filter((a) => !a.startsWith('[ref='))
    let name = l.name
    if (name && name.length > NAME_MAX) name = `${name.slice(0, NAME_KEEP)}…`
    let value = l.value
    if (value && value.length > 400 && !l.colon) value = value.slice(0, 400) + '…'
    out.push({ text: formatLine({ ...l, name, attrs, value }), children, extra: n.extra })
  }
  return out
}

// ── fold ───────────────────────────────────────────────────────────────────

function signature(n: ShapeNode, levels = 2): string {
  const own = roleOf(n.text)
  if (levels === 0 || n.children.length === 0) return own
  return `${own}(${n.children.map((c) => signature(c, levels - 1)).join(',')})`
}

/** The item's most telling name: the first one with real words (skips ranks like "4."). */
function firstName(n: ShapeNode): string {
  let fallback = ''
  const visit = (x: ShapeNode): string => {
    const l = parseLine(x.text)
    const cand = l?.name ?? (l && l.value && l.role !== '/url' && !l.role.startsWith('/') ? l.value : '')
    if (cand) {
      if (/\p{L}{2,}/u.test(cand)) return cand
      fallback ||= cand
    }
    for (const c of x.children) {
      const s = visit(c)
      if (s) return s
    }
    return ''
  }
  return visit(n) || fallback
}

function subtreeText(n: ShapeNode): string {
  return [n.text, ...(n.extra ?? []), ...n.children.map(subtreeText)].join('\n')
}

/** Names in document order that contain real words. */
function wordNames(n: ShapeNode): string[] {
  const out: string[] = []
  const visit = (x: ShapeNode) => {
    const l = parseLine(x.text)
    const cand = l?.name ?? (l && l.value && !l.role.startsWith('/') ? l.value : '')
    if (cand && /\p{L}{2,}/u.test(cand)) out.push(cand)
    for (const c of x.children) visit(c)
  }
  visit(n)
  return out
}

/** Hidden items by name: the name position that differs most between items ("upvote" does not). */
function namesLine(items: ShapeNode[]): string {
  const lists = items.map(wordNames)
  let pick = 0
  let distinct = 0
  for (let k = 0; k < 6; k++) {
    const d = new Set(lists.map((l) => l[k]).filter(Boolean)).size
    if (d > distinct) {
      distinct = d
      pick = k
    }
  }
  const names: string[] = []
  let used = 0
  for (const [i, it] of items.entries()) {
    const name = (lists[i][pick] ?? firstName(it)).replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!name) continue
    if (used + name.length + 4 > FOLD_NAMES_CHARS) break
    names.push(JSON.stringify(name))
    used += name.length + 4
  }
  const rest = items.length - names.length
  return names.length ? `: ${names.join(', ')}${rest > 0 ? `, … (+${rest})` : ''}` : ''
}

/**
 * Repeated same-shaped siblings (search results, product cards, table rows): keep the first
 * few (or those matching `focus`), summarize the rest with their names so the model can still
 * target them by name, and say how to see them all.
 */
export function foldRepeats(nodes: ShapeNode[], opts: { focus?: string } = {}, parentRef?: string): { nodes: ShapeNode[]; folded: number } {
  let folded = 0
  const focus = opts.focus?.toLowerCase()
  const visit = (list: ShapeNode[], ref: string | undefined): ShapeNode[] => {
    for (const n of list) n.children = visit(n.children, refOf(n.text) ?? ref)
    const sigs = list.map((n) => signature(n))
    const out: ShapeNode[] = []
    let i = 0
    while (i < list.length) {
      // Repeating unit of 1–4 siblings (Hacker News: title row, meta row, spacer row).
      let best = { period: 1, reps: 1 }
      for (let p = 1; p <= MAX_PERIOD && i + p <= list.length; p++) {
        let reps = 1
        while (i + (reps + 1) * p <= list.length && sigs.slice(i + reps * p, i + (reps + 1) * p).every((g, k) => g === sigs[i + k])) reps++
        if (reps * p > best.reps * best.period && reps >= (p === 1 ? FOLD_MIN_RUN : FOLD_MIN_GROUPS)) best = { period: p, reps }
      }
      const { period, reps } = best
      const groups: ShapeNode[][] = []
      for (let g = 0; g < reps; g++) groups.push(list.slice(i + g * period, i + (g + 1) * period))
      const runChars = groups.flat().reduce((s, n) => s + nodeSize(n, 0), 0)
      const minReps = period === 1 ? FOLD_MIN_RUN : FOLD_MIN_GROUPS
      if (reps >= minReps && runChars >= FOLD_MIN_CHARS && !sigs[i].startsWith('/')) {
        const text = (g: ShapeNode[]) => g.map(subtreeText).join('\n').toLowerCase()
        const hits = focus ? groups.filter((g) => text(g).includes(focus)).slice(0, FOLD_FOCUS_KEEP) : []
        const keep = new Set(hits.length ? hits : groups.slice(0, FOLD_KEEP))
        const hidden = groups.filter((g) => !keep.has(g))
        const role = roleOf(list[i].text) || 'item'
        const how = ref ? `browser_snapshot target=${ref} shows all` : 'browser_snapshot query="…" finds them'
        const label = period === 1 ? role : `${role} group`
        const summary: ShapeNode = { text: `- … ${hidden.length} more ${label}${hidden.length > 1 ? 's' : ''}${namesLine(hidden.map((g) => ({ text: '', children: g })))} · ${how}`, children: [] }
        const lastKept = groups.reduce((k, g, idx) => (keep.has(g) ? idx : k), 0)
        groups.forEach((g, idx) => {
          if (keep.has(g)) out.push(...g)
          if (idx === lastKept) out.push(summary)
        })
        folded += hidden.reduce((s, g) => s + g.length, 0)
        i += reps * period
      } else {
        out.push(list[i])
        i++
      }
    }
    return out
  }
  return { nodes: visit(nodes, parentRef), folded }
}

// ── fit to budget ──────────────────────────────────────────────────────────

const marker = (text: string): ShapeNode => ({ text, children: [] })

/** Drop lines inside one subtree: plain text first, then the rest, always from the end. */
function cutLines(n: ShapeNode, keepChars: number, depth: number, focus?: string): void {
  type Flat = { node: ShapeNode; parent: ShapeNode; depth: number; kept: boolean; keptKids: number; quiet?: boolean }
  const flat: Flat[] = []
  const walk = (p: ShapeNode, d: number) => {
    for (const c of p.children) {
      flat.push({ node: c, parent: p, depth: d, kept: true, keptKids: 0 })
      walk(c, d + 1)
    }
  }
  walk(n, depth + 1)
  const lineSize = (f: Flat) => f.depth * 2 + f.node.text.length + 1 + (f.node.extra ?? []).reduce((s, e) => s + f.depth * 2 + e.length + 1, 0)
  let size = nodeSize(n, depth)
  const index = new Map(flat.map((f) => [f.node, f]))
  for (const f of flat) {
    const p = index.get(f.parent)
    if (p) p.keptKids++
  }
  const matches = (f: Flat) => !!focus && f.node.text.toLowerCase().includes(focus)
  const reserve = 40
  for (const phase of [0, 1]) {
    for (let i = flat.length - 1; i >= 0 && size + reserve > keepChars; i--) {
      const f = flat[i]
      if (!f.kept || f.keptKids > 0) continue
      if (phase === 0 && (refOf(f.node.text) || matches(f))) continue
      f.kept = false
      f.quiet = phase === 0
      size -= lineSize(f)
      const p = index.get(f.parent)
      if (p) p.keptKids--
    }
  }
  // Rebuild: dropped text lines are summed into one note for the subtree; dropped structure
  // gets one marker per parent, where its first dropped child was.
  let quietLines = 0
  const rebuild = (p: ShapeNode) => {
    const next: ShapeNode[] = []
    let dropped = 0
    let at = -1
    for (const c of p.children) {
      const f = index.get(c)!
      if (!f.kept) {
        if (f.quiet) {
          quietLines += countLines(c)
          continue
        }
        if (at < 0) at = next.length
        dropped += countLines(c)
        continue
      }
      rebuild(c)
      next.push(c)
    }
    if (dropped) next.splice(at, 0, marker(`- … ${dropped} line${dropped > 1 ? 's' : ''} omitted`))
    p.children = next
  }
  rebuild(n)
  if (quietLines) n.children.push(marker(`- … ${quietLines} text line${quietLines > 1 ? 's' : ''} omitted here (mode:"text" or target=<ref> reads them)`))
}

function countLines(n: ShapeNode): number {
  return 1 + n.children.reduce((s, c) => s + countLines(c), 0)
}

function fitChildren(p: ShapeNode, budget: number, depth: number, focus?: string): void {
  const kids = p.children
  const sizes = kids.map((k) => nodeSize(k, depth))
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total <= budget) return
  if (kids.length === 1) {
    fitNode(kids[0], budget, depth, focus)
    return
  }
  const over = total - budget
  const ranked = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a])
  let tops = ranked.slice(0, 3)
  const big = tops.filter((i) => sizes[i] >= sizes[ranked[0]] * 0.1)
  if (big.reduce((s, i) => s + sizes[i], 0) >= over) tops = big
  const topTotal = tops.reduce((s, i) => s + sizes[i], 0)
  if (topTotal < over) {
    // No few big parts to take the cut. Many small parts: drop lines (text first) across them;
    // a few large ones: give every part a share of the budget.
    if (sizes[ranked[0]] < DESCEND) {
      cutLines(p, budget + p.text.length + 1 + Math.max(0, depth - 1) * 2, depth - 1, focus)
      return
    }
    kids.forEach((k, i) => {
      const keep = Math.floor((sizes[i] * budget) / total)
      if (keep > DESCEND) fitNode(k, keep, depth, focus)
      else cutLines(k, keep, depth, focus)
    })
    return
  }
  for (const i of tops) {
    const share = Math.ceil((over * sizes[i]) / topTotal)
    const keep = sizes[i] - share
    if (keep > DESCEND) fitNode(kids[i], keep, depth, focus)
    else cutLines(kids[i], Math.max(keep, 0), depth, focus)
  }
}

function fitNode(n: ShapeNode, budget: number, depth: number, focus?: string): void {
  const own = n.text.length + 1 + depth * 2
  if (nodeSize(n, depth) <= budget) return
  if (budget - own < 200) {
    cutLines(n, budget, depth, focus)
    return
  }
  fitChildren(n, budget - own, depth + 1, focus)
}

/** GenericAgent's smart_truncate on a line tree: shrink the biggest parts proportionally. */
export function fitBudget(nodes: ShapeNode[], budget: number, focus?: string): { nodes: ShapeNode[]; truncated: boolean } {
  const root: ShapeNode = { text: '', children: nodes }
  const size = () => root.children.reduce((s, n) => s + nodeSize(n, 0), 0)
  if (size() <= budget) return { nodes, truncated: false }
  const f = focus?.toLowerCase()
  // Shares are estimates (markers add lines): go around until it fits.
  for (let round = 0; round < 5 && size() > budget; round++) fitChildren(root, budget, 0, f)
  for (let round = 0; round < 3 && size() > budget; round++) cutLines(root, budget - round * 200, -1, f)
  return { nodes: root.children, truncated: true }
}

// ── entry ──────────────────────────────────────────────────────────────────

export function shapeSnapshot(yaml: string, opts: ShapeOptions = {}): ShapeResult {
  let nodes = slim(parseYaml(yaml), opts.origin)
  let folded = 0
  if (opts.fold !== false) ({ nodes, folded } = foldRepeats(nodes, { focus: opts.focus }))
  let truncated = false
  if (opts.budget) ({ nodes, truncated } = fitBudget(nodes, opts.budget, opts.focus))
  return { yaml: renderYaml(nodes), truncated, folded }
}
