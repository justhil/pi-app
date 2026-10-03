// Element inspection and readable page text for annotations and "send to chat".
// Runs in the isolated world (see index.ts); reads the DOM only.

import type { ElementDescriptor, PageContextResult } from '../../../packages/shared/browser-types'
import * as roleUtils from './vendor/playwright/injected/roleUtils'

const HINT_ATTRS = ['data-insp-path', 'data-v-inspector', 'data-source', 'data-locator', 'data-component-file', 'data-sentry-source-file']
const STYLE_KEYS = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'padding', 'margin', 'border-radius', 'gap']

const clean = (s: string | null | undefined, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const esc = (s: string) => (typeof globalThis.CSS?.escape === 'function' ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'))
const goodClass = (c: string) => /^[a-zA-Z][\w-]*$/.test(c) && c.length < 40
const unique = (sel: string) => {
  try {
    return document.querySelectorAll(sel).length === 1
  } catch {
    return false
  }
}

function selectorFor(node: Element): string {
  if (node.id && unique(`#${esc(node.id)}`)) return `#${esc(node.id)}`
  const parts: string[] = []
  for (let cur: Element | null = node; cur && cur !== document.documentElement; cur = cur.parentElement) {
    let part = cur.tagName.toLowerCase()
    if (cur.id) part += `#${esc(cur.id)}`
    const cls = [...cur.classList].filter(goodClass).slice(0, 2)
    if (cls.length) part += `.${cls.map(esc).join('.')}`
    const parent = cur.parentElement
    if (parent) {
      const tag = cur.tagName
      const same = [...parent.children].filter((c) => c.tagName === tag)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
    }
    parts.unshift(part)
    const sel = parts.join(' > ')
    if (unique(sel)) return sel
  }
  return parts.join(' > ')
}

/** Element under a viewport point, described for the composer. */
export function inspectAtPoint(x: number, y: number): ElementDescriptor | null {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  const hints: string[] = []
  for (let a: Element | null = el, depth = 0; a && depth < 8; a = a.parentElement, depth++) {
    for (const attr of HINT_ATTRS) {
      const v = a.getAttribute(attr)
      if (v && !hints.includes(v) && hints.length < 3) hints.push(v)
    }
  }
  const cs = getComputedStyle(el)
  const styles: Record<string, string> = {}
  for (const k of STYLE_KEYS) {
    const v = cs.getPropertyValue(k)
    if (v && v !== 'normal' && v !== 'none' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') styles[k] = v
  }
  const r = el.getBoundingClientRect()
  const out: ElementDescriptor = {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList].filter(goodClass).slice(0, 6),
    selector: selectorFor(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    styles,
    sourceHints: hints,
  }
  if (el.id) out.id = el.id
  roleUtils.beginAriaCaches()
  try {
    const role = roleUtils.getAriaRole(el)
    if (role) out.role = role
    const name = clean(roleUtils.getElementAccessibleNameText(el, false), 80)
    if (name) out.name = name
  } finally {
    roleUtils.endAriaCaches()
  }
  const text = clean((el as HTMLElement).innerText ?? el.textContent, 80)
  if (text) out.text = text
  return out
}

/** Readable main text and the current selection. */
export function pageContext(maxChars: number): PageContextResult {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body
  const raw = root ? ((root as HTMLElement).innerText ?? root.textContent) : ''
  const text = String(raw ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const sel = String(getSelection() ?? '').trim()
  return { title: document.title || '', url: location.href, text: text.slice(0, maxChars), selection: sel.slice(0, 20000), truncated: text.length > maxChars }
}
