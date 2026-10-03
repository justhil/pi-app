// pi Desktop browser page runtime. Bundled to an IIFE (scripts/build-page-runtime.mjs) and
// installed once per document into the host's ISOLATED world as `globalThis.__piBrowser`:
// it shares the DOM with the page but none of its JavaScript, and it never writes to the DOM.
// Engine-agnostic: the Electron engine and the stealth (Patchright) engine run the same code.

import { generateAriaTree, renderAriaTreeAsJSON, type AriaSnapshot } from './vendor/playwright/injected/ariaSnapshot'
import { renderAriaSnapshotAsYaml } from './vendor/playwright/isomorphic/ariaSnapshotRenderer'
import * as roleUtils from './vendor/playwright/injected/roleUtils'
import { inspectAtPoint, pageContext } from './inspect'

type Rect = { x: number; y: number; width: number; height: number }
type RefInfo = { element: Element; role: string; name: string; nth: number }

export type RuntimeError = { error: 'stale_ref' | 'not_found' | 'ambiguous' | 'invalid_target' | 'not_actionable' | 'denied'; message: string }

interface SnapshotOptions {
  target?: string
  depth?: number
  boxes?: boolean
  maxChars?: number
}

interface SnapshotResult {
  url: string
  title: string
  yaml: string
  truncated: boolean
  refCount: number
  belowFold: { count: number; screens: number }
  covered: number
}

const REF_RE = /^(?:f\d+)?e\d+$/
/** Roles the agent acts on; Playwright gives refs to every visible node, these are what we count. */
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem'])

let last: { refs: Map<string, RefInfo>; at: number; url: string } = { refs: new Map(), at: 0, url: '' }

const err = (error: RuntimeError['error'], message: string): RuntimeError => ({ error, message })
const isErr = (v: unknown): v is RuntimeError => !!v && typeof v === 'object' && 'error' in (v as object)

/** elementFromPoint that descends into open shadow roots. */
function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

/** Composed containment (crosses shadow roots). */
function containsDeep(parent: Element, child: Element | null): boolean {
  for (let n: Node | null = child; n; n = (n as Element).assignedSlot ?? n.parentNode ?? (n as ShadowRoot).host ?? null) {
    if (n === parent) return true
  }
  return false
}

/**
 * Point that actually reaches `el` (hit-test like Playwright's "receives events" check): center
 * first, then a few inner points. Null when the element is covered (e.g. by a modal) or offscreen.
 */
function hitPoint(el: Element): { x: number; y: number } | null {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  const fractions: [number, number][] = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.15, 0.5], [0.85, 0.5]]
  for (const [fx, fy] of fractions) {
    const x = r.left + r.width * fx
    const y = r.top + r.height * fy
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue
    const hit = deepElementFromPoint(x, y)
    if (hit && (hit === el || containsDeep(el, hit))) return { x, y }
  }
  return null
}

function inViewport(r: DOMRect): boolean {
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
}

type AriaNodeLike = { role: string; name: string; ref?: string; box?: { cursor?: string }; children: (AriaNodeLike | string)[] }

function walk(node: AriaNodeLike, fn: (n: AriaNodeLike) => void): void {
  fn(node)
  for (const c of node.children) if (typeof c !== 'string') walk(c, fn)
}

function scopeRoot(target?: string): Element | RuntimeError {
  if (!target) return document.body ?? document.documentElement
  return resolveElement(target)
}

export function snapshot(opts: SnapshotOptions = {}): SnapshotResult | RuntimeError {
  const root = scopeRoot(opts.target)
  if (isErr(root)) return root
  const tree: AriaSnapshot = generateAriaTree(root, { mode: 'ai', depth: opts.depth, boxes: opts.boxes })

  // Post-pass (browser-use idea): an element covered by another layer (modal, sticky banner)
  // keeps its line but loses its ref, so the model does not try to click through the overlay.
  let covered = 0
  let below = 0
  let lowest = 0
  const refs = new Map<string, RefInfo>()
  const seen = new Map<string, number>()
  walk(tree.root as unknown as AriaNodeLike, (n) => {
    if (!n.ref) return
    const info = tree.info.get(n.ref)
    if (!info) return
    const r = info.element.getBoundingClientRect()
    const interactive = INTERACTIVE.has(n.role) || n.box?.cursor === 'pointer'
    if (inViewport(r) && !hitPoint(info.element)) {
      if (interactive) covered++
      tree.info.delete(n.ref)
      n.ref = undefined
      return
    }
    if (interactive && r.top >= innerHeight) {
      below++
      lowest = Math.max(lowest, r.bottom)
    }
    const key = `${n.role}\u0000${n.name}`
    const nth = seen.get(key) ?? 0
    seen.set(key, nth + 1)
    refs.set(n.ref, { element: info.element, role: n.role, name: n.name, nth })
  })

  const { json } = renderAriaTreeAsJSON(tree, { mode: 'ai', depth: opts.depth, boxes: opts.boxes })
  let yaml = renderAriaSnapshotAsYaml(json)
  const maxChars = opts.maxChars ?? 40_000
  let truncated = false
  if (yaml.length > maxChars) {
    yaml = yaml.slice(0, yaml.lastIndexOf('\n', maxChars))
    truncated = true
  }
  if (!opts.target) last = { refs, at: Date.now(), url: location.href }
  else for (const [k, v] of refs) last.refs.set(k, v)
  return {
    url: location.href,
    title: document.title,
    yaml,
    truncated,
    refCount: refs.size,
    belowFold: { count: below, screens: below ? Math.max(1, Math.ceil((lowest - innerHeight) / innerHeight)) : 0 },
    covered,
  }
}

/** Re-find a ref whose element went away: same role + name, same position among equals (agent-browser idea). */
function relocate(info: RefInfo): Element | null {
  const tree = generateAriaTree(document.body, { mode: 'ai' })
  let n = 0
  let found: Element | null = null
  walk(tree.root as unknown as AriaNodeLike, (node) => {
    if (found || !node.ref || node.role !== info.role || node.name !== info.name) return
    if (n++ === info.nth) found = tree.info.get(node.ref)?.element ?? null
  })
  return found
}

function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) return t.slice(1, -1)
  return t
}

function textOf(el: Element): string {
  return (el as HTMLElement).innerText ?? el.textContent ?? ''
}

function allElements(): Element[] {
  const out: Element[] = []
  const visit = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      out.push(el)
      if (el.shadowRoot) visit(el.shadowRoot)
    }
  }
  visit(document)
  return out
}

function matchText(actual: string, wanted: string, exact: boolean): boolean {
  const a = actual.replace(/\s+/g, ' ').trim()
  return exact ? a === wanted : a.toLowerCase().includes(wanted.toLowerCase())
}

/** Locator-style targets: getByRole/Text/Label/Placeholder/TestId, role=…[name=…], text=…, else CSS. */
function queryTarget(target: string): Element[] | RuntimeError {
  const t = target.trim()
  const call = /^getBy(Role|Text|Label|Placeholder|TestId|AltText|Title)\(\s*(['"`])(.*?)\2\s*(?:,\s*(\{.*\}))?\s*\)$/s.exec(t)
  const exactOpt = (opts?: string) => !!opts && /exact\s*:\s*true/.test(opts)
  roleUtils.beginAriaCaches()
  try {
    if (call) {
      const [, kind, , arg, opts] = call
      const exact = exactOpt(opts)
      const visible = (el: Element) => !roleUtils.isElementHiddenForAria(el)
      switch (kind) {
        case 'Role': {
          const name = opts ? /name\s*:\s*(['"`])(.*?)\1/s.exec(opts)?.[2] : undefined
          return allElements().filter(
            (el) => visible(el) && roleUtils.getAriaRole(el) === arg && (name === undefined || matchText(roleUtils.getElementAccessibleNameText(el, false), name, exact)),
          )
        }
        case 'Text': {
          const hits = allElements().filter((el) => visible(el) && matchText(textOf(el), arg, exact))
          // Innermost matches only (a text match on <main> also matches its ancestors).
          return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))
        }
        case 'Label':
          return allElements().filter((el) => {
            const labels = (el as HTMLInputElement).labels
            return (labels && [...labels].some((l) => matchText(l.textContent ?? '', arg, exact))) || matchText(el.getAttribute('aria-label') ?? '\u0000', arg, exact)
          })
        case 'Placeholder':
          return allElements().filter((el) => matchText(el.getAttribute('placeholder') ?? '\u0000', arg, exact))
        case 'TestId':
          return allElements().filter((el) => el.getAttribute('data-testid') === arg)
        case 'AltText':
          return allElements().filter((el) => matchText(el.getAttribute('alt') ?? '\u0000', arg, exact))
        case 'Title':
          return allElements().filter((el) => matchText(el.getAttribute('title') ?? '\u0000', arg, exact))
      }
    }
    const role = /^role=([a-z]+)(?:\[name=(.*)\])?$/i.exec(t)
    if (role) {
      const name = role[2] !== undefined ? unquote(role[2]) : undefined
      return allElements().filter((el) => roleUtils.getAriaRole(el) === role[1] && (name === undefined || matchText(roleUtils.getElementAccessibleNameText(el, false), name, false)))
    }
    if (t.startsWith('text=')) return queryTarget(`getByText(${JSON.stringify(unquote(t.slice(5)))})`)
    const css = t.startsWith('css=') ? t.slice(4) : t
    try {
      return [...document.querySelectorAll(css)]
    } catch {
      return err('invalid_target', `"${target}" is neither a ref like e12 nor a valid selector`)
    }
  } finally {
    roleUtils.endAriaCaches()
  }
}

export function resolveElement(target: string): Element | RuntimeError {
  if (REF_RE.test(target)) {
    const info = last.refs.get(target)
    if (!info) return err('stale_ref', `ref ${target} is not in the latest snapshot; take a new snapshot`)
    if (info.element.isConnected) return info.element
    const again = relocate(info)
    if (again) {
      info.element = again
      return again
    }
    return err('stale_ref', `ref ${target} (${info.role} "${info.name}") is gone; take a new snapshot`)
  }
  const found = queryTarget(target)
  if (isErr(found)) return found
  if (found.length === 0) return err('not_found', `no element matches ${target}`)
  if (found.length > 1) return err('ambiguous', `${found.length} elements match ${target}; use a ref from browser_snapshot or a more specific locator`)
  return found[0]
}

function describe(el: Element): string {
  roleUtils.beginAriaCaches()
  try {
    const role = roleUtils.getAriaRole(el) ?? el.tagName.toLowerCase()
    const name = roleUtils.getElementAccessibleNameText(el, false)
    return name ? `${role} "${name.slice(0, 80)}"` : role
  } finally {
    roleUtils.endAriaCaches()
  }
}

export interface Actionable {
  point: { x: number; y: number }
  rect: Rect
  description: string
  tag: string
  inputType: string
  editable: boolean
  checked: boolean | 'mixed' | null
}

/**
 * Playwright-style actionability: attached, visible, enabled, stable for two frames, and the
 * point we will click actually hits the element. Scrolls it into view first, like a user would.
 */
export async function actionable(target: string, opts: { force?: boolean; timeoutMs?: number } = {}): Promise<Actionable | RuntimeError> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5000)
  let reason = 'not visible'
  let prev: DOMRect | null = null
  while (Date.now() < deadline) {
    const el = resolveElement(target)
    if (isErr(el)) return el
    const r0 = el.getBoundingClientRect()
    if (!inViewport(r0) || r0.top < 0 || r0.bottom > innerHeight) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
    await new Promise((res) => requestAnimationFrame(() => res(null)))
    const r = el.getBoundingClientRect()
    const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'
    const stable = !!prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 && Math.abs(prev.width - r.width) < 1
    prev = r
    if (r.width <= 0 || r.height <= 0) reason = 'not visible'
    else if (disabled && !opts.force) reason = 'disabled'
    else if (!stable) reason = 'still moving'
    else {
      const point = opts.force ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : hitPoint(el)
      if (point) {
        roleUtils.beginAriaCaches()
        let checked: boolean | 'mixed' | null = null
        try {
          const role = roleUtils.getAriaRole(el)
          if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox') checked = roleUtils.getAriaChecked(el)
        } finally {
          roleUtils.endAriaCaches()
        }
        return {
          point,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          description: describe(el),
          tag: el.tagName.toLowerCase(),
          inputType: ((el as HTMLInputElement).type ?? '').toLowerCase(),
          editable: (el as HTMLElement).isContentEditable || /^(input|textarea)$/i.test(el.tagName),
          checked,
        }
      }
      const hit = deepElementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      reason = hit ? `covered by ${describe(hit)}` : 'outside the viewport'
    }
    await new Promise((res) => setTimeout(res, 80))
  }
  return err('not_actionable', `${target} is ${reason}`)
}

/** Focus a text field and select its content (inputs, textareas and rich editors alike). */
export function prepareInput(target: string, opts: { keep?: boolean } = {}): { kind: 'value' | 'contenteditable' } | RuntimeError {
  const el = resolveElement(target)
  if (isErr(el)) return el
  const html = el as HTMLElement
  html.focus()
  if (html.isContentEditable) {
    const editable = (html.closest('[contenteditable="true"],[contenteditable=""]') as HTMLElement) ?? html
    const sel = getSelection()
    const range = document.createRange()
    range.selectNodeContents(editable)
    if (opts.keep) range.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(range)
    return { kind: 'contenteditable' }
  }
  if (typeof (html as HTMLInputElement).select === 'function') {
    if (opts.keep) {
      const input = html as HTMLInputElement
      const end = input.value.length
      try {
        input.setSelectionRange(end, end)
      } catch {
        /* input types without selection (number, email) */
      }
    } else (html as HTMLInputElement).select()
    return { kind: 'value' }
  }
  return err('denied', `${describe(el)} is not a text field`)
}

export function selectOptions(target: string, values: string[]): { selected: string[] } | RuntimeError {
  const el = resolveElement(target)
  if (isErr(el)) return el
  if (el.tagName !== 'SELECT') return err('denied', `${describe(el)} is not a <select>; click it and pick the option instead`)
  const select = el as HTMLSelectElement
  const picked: string[] = []
  for (const v of values) {
    const opt = [...select.options].find((o) => o.value === v || o.label.trim() === v || o.text.trim() === v)
    if (!opt) return err('not_found', `no option ${JSON.stringify(v)}; options: ${[...select.options].map((o) => o.label.trim()).slice(0, 20).join(', ')}`)
    picked.push(opt.value)
  }
  if (!select.multiple && picked.length > 1) return err('denied', 'this select takes one value')
  for (const o of select.options) o.selected = picked.includes(o.value)
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return { selected: picked }
}

export function setFiles(target: string, files: { name: string; type: string; base64: string }[]): { count: number } | RuntimeError {
  const el = resolveElement(target)
  if (isErr(el)) return el
  const input = (el.tagName === 'INPUT' ? el : el.querySelector('input[type=file]')) as HTMLInputElement | null
  if (!input || input.type !== 'file') return err('denied', `${describe(el)} is not a file input`)
  const dt = new DataTransfer()
  for (const f of files) {
    const bin = atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    dt.items.add(new File([bytes], f.name, { type: f.type || 'application/octet-stream' }))
  }
  input.files = dt.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return { count: dt.files.length }
}

/** Range inputs have no text to type; set the value like a drag would end up and notify the page. */
export function setRangeValue(target: string, value: string): { value: string } | RuntimeError {
  const el = resolveElement(target)
  if (isErr(el)) return el
  const input = el as HTMLInputElement
  if (el.tagName !== 'INPUT' || input.type !== 'range') return err('denied', `${describe(el)} is not a slider`)
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return { value: input.value }
}

/** Is this target a file input (or a label for one)? Clicking those would open a native dialog. */
export function isFileTarget(target: string): boolean {
  const el = resolveElement(target)
  if (isErr(el)) return false
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') return true
  const forId = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : null
  return !!forId && forId.tagName === 'INPUT' && (forId as HTMLInputElement).type === 'file'
}

/** Playwright's browser_find: matching snapshot lines, each under its ancestor path. */
export function find(query: { text?: string; regex?: string }): { matches: string; count: number } | RuntimeError {
  let re: RegExp
  try {
    if (query.regex) {
      const m = /^\/(.*)\/([a-z]*)$/s.exec(query.regex)
      re = m ? new RegExp(m[1], m[2]) : new RegExp(query.regex)
    } else if (query.text) re = new RegExp(query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    else return err('invalid_target', 'pass text or regex')
  } catch (e) {
    return err('invalid_target', `bad regex: ${(e as Error).message}`)
  }
  const snap = snapshot({ maxChars: 1_000_000 })
  if (isErr(snap)) return snap
  const lines = snap.yaml.split('\n')
  const indent = (s: string) => s.length - s.trimStart().length
  const out: string[] = []
  let count = 0
  lines.forEach((line, i) => {
    if (!re.test(line) || count >= 20) return
    count++
    const path: string[] = []
    let level = indent(line)
    for (let j = i - 1; j >= 0 && level > 0; j--) {
      if (indent(lines[j]) < level) {
        path.unshift(lines[j])
        level = indent(lines[j])
      }
    }
    out.push([...path, line, ...lines.slice(i + 1, i + 3).filter((l) => indent(l) > indent(line))].join('\n'))
  })
  return { matches: out.join('\n\n'), count }
}

export function pageHasText(text: string): boolean {
  return !!document.body && textOf(document.body).includes(text)
}

export { inspectAtPoint, pageContext }

export const version = 1
