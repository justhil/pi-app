import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { WebContents } from 'electron'
import { clickPoint, pointerPath, typingChunks } from './humanize'
import { PAGE_HAS_TEXT, RESOLVE_REF, SELECT_FIELD, SELECT_OPTION, SET_FILES, SNAPSHOT } from './page-scripts'

/** Isolated world shared with the other host page scripts (refs live here). */
export const SCRIPT_WORLD = 1999
const SCRIPT_TIMEOUT_MS = 2000
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export class BrowserToolError extends Error {
  constructor(
    readonly code:
      | 'browser_stale_ref'
      | 'browser_timeout'
      | 'browser_denied'
      | 'browser_dialog_pending'
      | 'browser_no_tab'
      | 'browser_busy',
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Run a script in the isolated world; a page blocked by alert()/confirm() never answers. */
export async function inPage<T>(wc: WebContents, code: string, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code }]) as Promise<T>,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new BrowserToolError('browser_dialog_pending', 'the page is waiting on a dialog; ask the user to close it')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const js = (v: unknown) => JSON.stringify(v)

function fail(result: unknown): void {
  const err = (result as { error?: string } | null)?.error
  if (!err) return
  const code = err.split(':')[0] as BrowserToolError['code']
  throw new BrowserToolError(code === 'browser_stale_ref' || code === 'browser_denied' ? code : 'browser_denied', err)
}

export interface SnapshotResult {
  title: string
  url: string
  text: string
  truncated: boolean
}

export async function snapshot(wc: WebContents, maxChars: number, scope?: string): Promise<SnapshotResult> {
  const res = await inPage<SnapshotResult & { error?: string }>(wc, `(${SNAPSHOT})(${js(maxChars)}, ${js(scope ?? null)})`)
  fail(res)
  return res
}

interface Resolved {
  rect: { x: number; y: number; width: number; height: number }
  tag: string
  type: string
  editable: boolean
  disabled: boolean
  visible: boolean
  viewport: { width: number; height: number }
}

/** Resolve a ref and wait until its box is visible, enabled and stable for two frames. */
export async function actionable(wc: WebContents, ref: string, timeoutMs = 5000): Promise<Resolved> {
  const started = Date.now()
  let last: Resolved | null = null
  while (Date.now() - started < timeoutMs) {
    const r = await inPage<Resolved & { error?: string }>(wc, `(${RESOLVE_REF})(${js(ref)}, true)`)
    fail(r)
    const same =
      last &&
      Math.abs(last.rect.x - r.rect.x) < 1 &&
      Math.abs(last.rect.y - r.rect.y) < 1 &&
      Math.abs(last.rect.width - r.rect.width) < 1
    if (r.visible && !r.disabled && same) return r
    last = r
    await sleep(60)
  }
  if (last?.disabled) throw new BrowserToolError('browser_timeout', `${ref} stayed disabled`)
  throw new BrowserToolError('browser_timeout', `${ref} never became visible and stable`)
}

/** Real (trusted) pointer input along a human-like path; remembers where the pointer is. */
export class Pointer {
  private pos = { x: 40, y: 40 }

  constructor(private readonly wc: WebContents) {}

  async moveTo(x: number, y: number): Promise<void> {
    for (const p of pointerPath(this.pos, { x, y })) {
      if (p.delay) await sleep(p.delay)
      this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    }
    this.pos = { x, y }
  }

  async click(x: number, y: number, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: string[] } = {}): Promise<void> {
    await this.moveTo(x, y)
    await sleep(40 + Math.random() * 80)
    const button = opts.button ?? 'left'
    const modifiers = (opts.modifiers ?? []) as Electron.InputEvent['modifiers']
    const count = opts.clickCount ?? 1
    for (let i = 1; i <= count; i++) {
      this.wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i, modifiers })
      await sleep(50 + Math.random() * 60)
      this.wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i, modifiers })
      if (i < count) await sleep(70)
    }
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await this.moveTo(from.x, from.y)
    this.wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    await sleep(120)
    for (const p of pointerPath(from, to)) {
      await sleep(p.delay + 6)
      this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y, button: 'left' } as Electron.MouseInputEvent)
    }
    this.pos = to
    await sleep(80)
    this.wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
  }

  wheel(x: number, y: number, deltaY: number, deltaX = 0): void {
    // Electron's wheel deltas are the opposite sign of DOM WheelEvent deltas.
    this.wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -deltaX, deltaY: -deltaY, canScroll: true })
  }
}

const KEY_ALIASES: Record<string, string> = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  ' ': 'Space',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

/** `Enter`, `ArrowDown`, `Control+A`, `Meta+Shift+K` → Electron keyCode + modifiers. */
export function parseKey(spec: string): { keyCode: string; modifiers: string[] } {
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop() ?? ''
  const modifiers = parts.map((m) => {
    const l = m.toLowerCase()
    return l === 'ctrl' ? 'control' : l === 'cmd' || l === 'command' ? 'meta' : l === 'option' ? 'alt' : l
  })
  const keyCode = KEY_ALIASES[key.toLowerCase()] ?? (key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1))
  return { keyCode, modifiers }
}

export async function pressKey(wc: WebContents, spec: string): Promise<void> {
  const { keyCode, modifiers } = parseKey(spec)
  const mods = modifiers as Electron.InputEvent['modifiers']
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods })
  if (keyCode.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) {
    wc.sendInputEvent({ type: 'char', keyCode, modifiers: mods })
  }
  await sleep(30 + Math.random() * 50)
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods })
}

/** Type into the focused element as trusted text input, with human-ish pacing. */
export async function typeText(wc: WebContents, text: string): Promise<void> {
  for (const chunk of typingChunks(text)) {
    await wc.insertText(chunk.text)
    await sleep(chunk.delay)
  }
}

export async function focusAndSelect(wc: WebContents, ref: string): Promise<void> {
  fail(await inPage(wc, `(${SELECT_FIELD})(${js(ref)})`))
}

export async function selectOption(wc: WebContents, ref: string, value: string): Promise<string> {
  const res = await inPage<{ selected?: string; error?: string }>(wc, `(${SELECT_OPTION})(${js(ref)}, ${js(value)})`)
  fail(res)
  return res.selected ?? value
}

/** Files must live inside the agent's workspace; read them in Main and hand them to the page. */
export async function uploadFiles(wc: WebContents, ref: string, files: string[], cwd: string): Promise<number> {
  if (!cwd) throw new BrowserToolError('browser_denied', 'no workspace to upload from')
  const root = await realpath(cwd)
  const payload: { name: string; type: string; base64: string }[] = []
  let total = 0
  for (const f of files) {
    const abs = await realpath(isAbsolute(f) ? f : resolve(root, f)).catch(() => '')
    const rel = abs ? relative(root, abs) : '..'
    if (!abs || rel.startsWith('..') || isAbsolute(rel)) throw new BrowserToolError('browser_denied', `${f} is outside the workspace`)
    const info = await stat(abs)
    total += info.size
    if (!info.isFile() || total > MAX_UPLOAD_BYTES) throw new BrowserToolError('browser_denied', `${f} is not a file or uploads exceed 20 MB`)
    payload.push({ name: basename(abs), type: '', base64: (await readFile(abs)).toString('base64') })
  }
  const res = await inPage<{ count?: number; error?: string }>(wc, `(${SET_FILES})(${js(ref)}, ${js(payload)})`, 10_000)
  fail(res)
  return res.count ?? payload.length
}

export async function waitFor(wc: WebContents, cond: { text?: string; url?: string }, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (cond.url && wc.getURL().includes(cond.url)) return
    if (cond.text && (await inPage<boolean>(wc, `(${PAGE_HAS_TEXT})(${js(cond.text)})`).catch(() => false))) return
    await sleep(250)
  }
  throw new BrowserToolError('browser_timeout', `waited ${timeoutMs} ms for ${cond.text ? `text ${js(cond.text)}` : `url ${js(cond.url)}`}`)
}

/** After an action: give navigation / re-render a moment to start and settle (bounded). */
export async function settle(wc: WebContents, maxMs = 4000): Promise<void> {
  await sleep(250)
  const started = Date.now()
  while (wc.isLoading() && Date.now() - started < maxMs) await sleep(100)
}

export function centerOf(r: Resolved): { x: number; y: number } {
  return clickPoint(r.rect)
}
