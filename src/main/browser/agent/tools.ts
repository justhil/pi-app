// Executes browser_* tool calls against a tab's PageEngine. Engine-agnostic: everything here
// goes through PageEngine + the page runtime (`__piBrowser`), so engine S reuses it unchanged.
// Results follow Playwright MCP's sections, kept short: what happened, where we are, what changed.

import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { BROWSER_BATCH_EXCLUDED, BROWSER_TOOL_DEFS, checkArgs } from '@shared/browser-tools'
import { isAllowedBrowserUrl, type BrowserDownloadInfo, type BrowserEvent, type BrowserTabInfo } from '@shared/browser-types'
import type { Modifier, PageEngine } from '../engines/types'
import { BrowserToolError, unwrap, type RuntimeError } from './errors'
import { Pointer, targetPoint, typeText } from './input'
import { compactSnapshot, diffSnapshots } from './snapshot-diff'
import { shapeSnapshot } from './snapshot-shape'
import { mainWorldEval } from './main-world'
import { scopeOf, withFrames } from './frames'
import { waitForHelp } from './help'
import { appendSiteNote, hostKey, readSiteNotes, siteNotesSection } from './site-notes'
import { formatEntry, redactHeaders } from '../cdp/network-log'
import type { CdpTab } from '../cdp/cdp-tab'

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

export interface BrowserToolCall {
  tool: string
  args: unknown
  sessionKey: string
  cwd: string
  /** Aborted when the turn stops: long waits (help, downloads) end early. */
  signal?: AbortSignal
  /** A step of browser_batch: the batch itself adds per-call extras (site notes). */
  nested?: boolean
}

/** What the executor needs from the browser host (BrowserHost implements it). */
export interface AgentBrowserHost {
  list(): { tabs: BrowserTabInfo[]; activeTabId: string | null }
  openTab(opts: { url?: string; focus?: boolean; openedBy?: BrowserTabInfo['openedBy'] }): BrowserTabInfo | Promise<BrowserTabInfo>
  closeTab(tabId: string): void
  /** `window`: also bring the browser window forward (help requests). */
  focusTab(tabId: string, opts?: { window?: boolean }): void
  agentTab(tabId: string): { info: BrowserTabInfo; engine: PageEngine; pointer: Pointer }
  runOnTab<T>(tabId: string, action: string, work: () => Promise<T>): Promise<T>
  /** Downloads this browser knows about (newest last). */
  downloads(): BrowserDownloadInfo[]
  /** Which browser this is: the built-in panel or the user's Chrome. */
  readonly kind: 'builtin' | 'chrome'
  /** Tell the Renderer (help requests and the like). */
  notify(event: BrowserEvent): void
  /** The user's own tabs a conversation may borrow (Chrome only). */
  userTabs?(): Promise<{ chromeTabId: number; title: string; url: string }[]>
  /** Lend a user tab to a conversation / give it back (Chrome only). */
  borrow?(chromeTabId: number, sessionKey: string): Promise<BrowserTabInfo>
  giveBack?(tabId: string): Promise<void>
}

interface Snap {
  url: string
  title: string
  yaml: string
  truncated: boolean
  refCount: number
  belowFold: { count: number; screens: number }
  covered: number
  visual?: number
  gates?: ('login' | 'captcha')[]
  modal?: { description: string; behind: number }
}

interface Actionable {
  point: { x: number; y: number }
  rect: { x: number; y: number; width: number; height: number }
  description: string
  tag: string
  inputType: string
  editable: boolean
  checked: boolean | 'mixed' | null
}

/** What the model sees of one snapshot, after slimming and folding. */
const SNAPSHOT_MAX_CHARS = 40_000
/** Raw snapshot cap: the shaped view and diffs work from this. */
const RAW_MAX_CHARS = 400_000
const BASELINE_MAX_AGE_MS = 5000
const ACTION_TIMEOUT_MS = 5000
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const DEFS = new Map(BROWSER_TOOL_DEFS.map((d) => [d.name, d]))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const js = (v: unknown) => JSON.stringify(v)
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })

/** Latest snapshot per tab: the "before" side of the next action's diff. */
const lastSnap = new Map<string, Snap & { at: number }>()
/** Last viewport/element screenshot per tab: image pixels → CSS viewport pixels. */
const lastShot = new Map<string, { scale: number; originX: number; originY: number; width: number; height: number }>()
/** Selected tab per conversation. */
const currentTab = new Map<string, string>()

/** Tabs a conversation sees: the user's tabs and its own, never another conversation's. */
export function sessionTabs(tabs: BrowserTabInfo[], sessionKey: string): BrowserTabInfo[] {
  return tabs.filter((t) => t.openedBy === 'user' || t.openedBy.sessionKey === sessionKey)
}

function currentTabId(host: AgentBrowserHost, sessionKey: string, required = true): string | null {
  const { tabs, activeTabId } = host.list()
  const mine = sessionTabs(tabs, sessionKey)
  const chosen = currentTab.get(sessionKey)
  if (chosen && mine.some((t) => t.tabId === chosen)) return chosen
  const id = (activeTabId && mine.some((t) => t.tabId === activeTabId) ? activeTabId : mine.at(-1)?.tabId) ?? null
  if (!id && required) throw new BrowserToolError('browser_no_tab', 'no tab is open; call browser_navigate or browser_tabs with action "new"')
  if (id) currentTab.set(sessionKey, id)
  return id
}

/**
 * After an action: let a navigation finish, then wait until the page has no requests in
 * flight and its DOM has gone quiet, so results rendered after a fetch are part of the
 * reported changes. Bounded: a page that keeps polling costs at most ~3 s.
 */
async function settle(engine: PageEngine, maxMs = 4000): Promise<void> {
  await sleep(120)
  if (engine.dialog?.pending()) return
  const started = Date.now()
  while (engine.isLoading() && Date.now() - started < maxMs) await sleep(100)
  const deadline = Date.now() + 3000
  for (;;) {
    while (engine.pendingRequests() > 0 && Date.now() < deadline) await sleep(50)
    const left = deadline - Date.now()
    await engine.run<unknown>(`__piBrowser.quiet({ idleMs: 200, timeoutMs: ${Math.max(200, left)} })`, Math.max(1500, left + 1000)).catch(() => undefined)
    // A response that rendered and then fired another request: go around once more.
    if (engine.pendingRequests() === 0 || Date.now() >= deadline) return
  }
}

async function takeSnapshot(tabId: string, engine: PageEngine, opts: { target?: string; depth?: number; boxes?: boolean } = {}): Promise<Snap> {
  // A ref inside a frame scopes the snapshot to that frame's runtime.
  const snap = unwrap(await scopeOf(engine, opts.target).run<Snap | RuntimeError>(`__piBrowser.snapshot(${js({ ...opts, maxChars: RAW_MAX_CHARS })})`, 8000))
  if (!opts.target && !snap.modal) snap.yaml = await withFrames(engine, snap.yaml)
  if (!opts.target && !opts.depth) lastSnap.set(tabId, { ...snap, at: Date.now() })
  return snap
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** The model's view of a raw snapshot: slimmed, repeated lists folded, cut to the budget. */
function shaped(snap: Snap, opts: { target?: string; focus?: string } = {}): Snap {
  const out = shapeSnapshot(snap.yaml, { origin: originOf(snap.url), focus: opts.focus, fold: !opts.target, budget: SNAPSHOT_MAX_CHARS })
  return { ...snap, yaml: out.yaml, truncated: snap.truncated || out.truncated }
}

/** Raw snapshot with the token diet only (no folding): the basis for "what changed". */
function slimmed(snap: Snap): string {
  return shapeSnapshot(snap.yaml, { origin: originOf(snap.url), fold: false }).yaml
}

/** Interactive outline of a page the model has not seen yet. */
function outline(snap: Snap): string {
  return compactSnapshot(shapeSnapshot(snap.yaml, { origin: originOf(snap.url) }).yaml) || '(no interactive elements)'
}

function pageSection(engine: PageEngine, prevUrl?: string): string {
  const url = engine.url()
  const moved = prevUrl !== undefined && prevUrl !== url
  return `### Page\nURL: ${url}${moved ? ' (changed)' : ''}\nTitle: ${engine.title() || '(untitled)'}`
}

function snapshotNotes(snap: Snap, tabId?: string): string {
  const notes: string[] = []
  if (snap.modal) {
    notes.push(`Showing only the dialog ${snap.modal.description}; ${snap.modal.behind} control(s) of the page behind it are hidden. Close it, or browser_snapshot target=body to read the page.`)
  } else if (snap.covered) notes.push(`${snap.covered} element(s) are covered by an overlay and have no ref; deal with the overlay first.`)
  if (snap.belowFold.count) notes.push(`${snap.belowFold.count} more interactive element(s) below the visible area (about ${snap.belowFold.screens} screen(s)); they keep their refs.`)
  if (snap.visual) notes.push(`${snap.visual} canvas area(s) are drawn as pixels: browser_take_screenshot shows them.`)
  if (snap.truncated) notes.push('Snapshot truncated: use target=<ref> for one region, query="…", or saveTo for the whole page in a file.')
  if (tabId) notes.push(...situationHints(tabId, snap))
  return notes.join('\n')
}

/** Guidance that only matters on some pages, given when the page needs it (once per page). */
const HINTS = {
  submenu: '[has-submenu] opens on hover: browser_hover it, then use the new refs (browser_snapshot probeHover:true lists every menu).',
  guessed: 'A name like "~search" is guessed from an icon or tooltip; the ref is what counts.',
  captcha: 'This page has a CAPTCHA / human check. If it does not pass by itself, call browser_request_help so the user can do it.',
  login: 'This page asks to sign in. Use credentials only if the user gave them; otherwise browser_request_help.',
} as const
const hintsShown = new Map<string, { url: string; shown: Set<keyof typeof HINTS> }>()

function situationHints(tabId: string, snap: Snap): string[] {
  let seen = hintsShown.get(tabId)
  if (!seen || seen.url !== snap.url) hintsShown.set(tabId, (seen = { url: snap.url, shown: new Set() }))
  const due: (keyof typeof HINTS)[] = []
  if (snap.yaml.includes('[has-submenu]')) due.push('submenu')
  if (snap.yaml.includes('"~')) due.push('guessed')
  for (const g of snap.gates ?? []) due.push(g)
  const fresh = due.filter((k) => !seen.shown.has(k))
  for (const k of fresh) seen.shown.add(k)
  return fresh.map((k) => HINTS[k])
}

/**
 * Wrap a page action: make sure we have a fresh "before" snapshot, act, let the page settle,
 * then report what changed (or a compact outline when the action navigated).
 */
async function act(tabId: string, engine: PageEngine, done: () => Promise<string>): Promise<ToolResult> {
  const known = lastSnap.get(tabId)
  const fresh = known && known.url === engine.url() && Date.now() - known.at < BASELINE_MAX_AGE_MS
  const before = fresh ? known : await takeSnapshot(tabId, engine).catch(() => null)
  const beforeUrl = engine.url()
  await engine.run<boolean>('__piBrowser.transients.start()').catch(() => false)
  const net = engine.cdpTab()?.network
  const netFrom = net?.seq()
  const summary = await done()
  await settle(engine)
  // A navigation replaced the document (and the watcher with it): nothing to report then.
  const flashes = engine.dialog?.pending() ? [] : await engine.run<string[]>('__piBrowser.transients.take()').catch(() => [] as string[])
  const parts = [`### Result\n${summary}`, pageSection(engine, beforeUrl)]
  if (flashes.length) parts.push(`### Transient messages\n${flashes.map((f) => `- ${f}`).join('\n')}`)
  const requests = net && netFrom !== undefined ? net.since(netFrom) : []
  if (requests.length) parts.push(`### Network\n${requests.map((r) => formatEntry(r, originOf(engine.url()))).join('\n')}`)
  let after: Snap | null = null
  try {
    // A known open dialog blocks every script: say so now instead of waiting for a timeout.
    if (engine.dialog?.pending()) throw new BrowserToolError('browser_dialog_pending', 'dialog open')
    after = await takeSnapshot(tabId, engine)
  } catch (error) {
    if (error instanceof BrowserToolError && error.code === 'browser_dialog_pending') {
      const d = engine.dialog?.pending()
      parts.push(
        d
          ? `### Modal state\nA ${d.type} dialog is open: ${js(d.message.slice(0, 300))}. Call browser_handle_dialog (accept or dismiss).`
          : '### Modal state\nA dialog (alert/confirm/prompt) is blocking the page. Call browser_handle_dialog.',
      )
      return text(parts.join('\n'))
    }
    throw error
  }
  if (after.url !== before?.url) parts.push(`### Snapshot (new page, interactive elements)\n${outline(after)}`)
  else if (after.modal && !before?.modal) parts.push(`### Dialog opened: ${after.modal.description}\n${shaped(after).yaml}`)
  else if (!after.modal && before?.modal) parts.push(`### Dialog closed (page, interactive elements)\n${outline(after)}`)
  else parts.push(`### Changes\n${(before && diffSnapshots(slimmed(before), slimmed(after))) ?? 'none'}`)
  const notes = snapshotNotes(after, tabId)
  if (notes) parts.push(notes)
  return text(parts.join('\n'))
}

function requireCdp(engine: PageEngine, what: string): CdpTab {
  const cdp = engine.cdpTab()
  if (!cdp) throw new BrowserToolError('browser_unsupported', `${what} need the DevTools protocol, which is off (Settings → Browser → Agent DevTools protocol)`)
  return cdp
}

const FOLLOW_SCREENS = 20

/**
 * BrowserSkill's `--scope follow`: scroll to the bottom screen by screen so lazy content loads,
 * until the page stops growing, then go back to where the user was.
 */
async function followLazyContent(engine: PageEngine): Promise<string> {
  const [startY, , vh] = await engine.run<[number, number, number]>('[scrollY, document.documentElement.scrollHeight, innerHeight]')
  let y = startY
  let still = 0
  let screens = 0
  for (; screens < FOLLOW_SCREENS && still < 2; screens++) {
    const before = await engine.run<number>('document.documentElement.scrollHeight')
    y = Math.min(y + vh, before)
    await engine.run<unknown>(`scrollTo(0, ${Math.round(y)})`)
    await engine.run<unknown>('__piBrowser.quiet({ idleMs: 300, timeoutMs: 2000 })', 3000).catch(() => undefined)
    const after = await engine.run<number>('document.documentElement.scrollHeight')
    still = after === before && y + vh >= after ? still + 1 : 0
  }
  await engine.run<unknown>(`scrollTo(0, ${Math.round(startY)})`)
  return screens >= FOLLOW_SCREENS && still < 2 ? `scrolled ${FOLLOW_SCREENS} screens; more may load below` : ''
}

const HOVER_PROBES = 8

/**
 * BrowserSkill's hover probing: hover each `[has-submenu]` trigger and report what appeared,
 * so the model sees hover-only menus without trial and error. Refs stay valid: hover the
 * trigger again, then click the item.
 */
async function probeHover(tabId: string, engine: PageEngine, pointer: Pointer, base: Snap): Promise<string> {
  const triggers = [...base.yaml.matchAll(/^\s*- (\w+)(?: "([^"]*)")? \[ref=((?:f\d+)?e\d+)\][^\n]*\[has-submenu\]/gm)].slice(0, HOVER_PROBES)
  if (!triggers.length) return ''
  const out: string[] = []
  for (const [, role, name, ref] of triggers) {
    const label = `${ref} ${role}${name ? ` "${name}"` : ''}`
    try {
      const probe = await actionable(engine, ref)
      const { ptr, p } = aim(pointer, probe)
      await ptr.moveTo(p.x, p.y)
      await engine.run<unknown>('__piBrowser.quiet({ idleMs: 250, timeoutMs: 1500 })', 3000).catch(() => undefined)
      const after = await takeSnapshot(tabId, engine)
      const added = (diffSnapshots(slimmed(base), slimmed(after), 16) ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('+'))
      out.push(added.length ? `- ${label}:\n${added.map((l) => `    ${l}`).join('\n')}` : `- ${label}: nothing appeared`)
    } catch (error) {
      out.push(`- ${label}: ${(error as Error).message}`)
    }
  }
  await pointer.moveTo(2, 2)
  await engine.run<unknown>('__piBrowser.quiet({ idleMs: 200, timeoutMs: 1000 })', 2000).catch(() => undefined)
  lastSnap.delete(tabId)
  hintsShown.delete(tabId)
  return `### Hover menus (hover the trigger, then click the item)\n${out.join('\n')}`
}

/** Pointers that send straight to an out-of-process frame's target (keyed by its session). */
const framePointers = new WeakMap<PageEngine, Map<string, Pointer>>()

function framePointer(engine: PageEngine, sessionId: string): Pointer {
  let m = framePointers.get(engine)
  if (!m) framePointers.set(engine, (m = new Map()))
  let p = m.get(sessionId)
  if (!p) m.set(sessionId, (p = new Pointer({ mouse: engine.cdpTab()!.frameMouse(sessionId) } as unknown as PageEngine)))
  return p
}

interface Aimed extends Actionable {
  /** Out-of-process frame: aim with this pointer at frame coordinates instead. */
  local?: { point: { x: number; y: number }; rect: Actionable['rect']; pointer: Pointer }
}

async function actionable(engine: PageEngine, target: string, opts: { force?: boolean } = {}): Promise<Aimed> {
  const scope = scopeOf(engine, target)
  await scope.reveal()
  const a = unwrap(
    await scope.run<Actionable | RuntimeError>(`__piBrowser.actionable(${js(target)}, ${js({ ...opts, timeoutMs: ACTION_TIMEOUT_MS })})`, ACTION_TIMEOUT_MS + 2000),
  )
  if (!scope.frameId) return a
  // Inside a frame: the runtime measured in frame coordinates; input goes to the top viewport,
  // except for out-of-process frames, which get their input directly.
  const point = await scope.toTop(a.point)
  const corner = await scope.toTop({ x: a.rect.x, y: a.rect.y })
  const session = engine.cdpTab()?.frameSession(scope.frameId)
  return {
    ...a,
    point: { x: point.x, y: point.y },
    rect: { x: corner.x, y: corner.y, width: a.rect.width * corner.scale, height: a.rect.height * corner.scale },
    ...(session ? { local: { point: a.point, rect: a.rect, pointer: framePointer(engine, session) } } : {}),
  }
}

/** The pointer and point to act on an element with. */
function aim(pointer: Pointer, a: Aimed): { ptr: Pointer; p: { x: number; y: number } } {
  if (a.local) return { ptr: a.local.pointer, p: targetPoint(a.local.point, a.local.rect) }
  return { ptr: pointer, p: targetPoint(a.point, a.rect) }
}

async function clickTarget(engine: PageEngine, pointer: Pointer, target: string, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: Modifier[] } = {}): Promise<Actionable> {
  const a = await actionable(engine, target)
  const { ptr, p } = aim(pointer, a)
  await ptr.click(p.x, p.y, opts)
  return a
}

async function typeInto(engine: PageEngine, pointer: Pointer, target: string, value: string, opts: { append?: boolean; submit?: boolean } = {}): Promise<string> {
  const a = await clickTarget(engine, pointer, target)
  unwrap(await scopeOf(engine, target).run<unknown>(`__piBrowser.prepareInput(${js(target)}, ${js({ keep: !!opts.append })})`))
  if (value) await typeText(engine, value)
  else if (!opts.append) await engine.keyboard.press('Backspace')
  if (opts.submit) await engine.keyboard.press('Enter')
  return a.description
}

const MODIFIERS: Record<string, Modifier> = { Alt: 'alt', Control: 'control', Meta: 'meta', Shift: 'shift' }
const toModifiers = (list: string[] = []): Modifier[] =>
  list.map((m) => (m === 'ControlOrMeta' ? (process.platform === 'darwin' ? 'meta' : 'control') : MODIFIERS[m]))

async function readUploads(paths: string[], cwd: string): Promise<{ name: string; type: string; base64: string }[]> {
  if (!cwd) throw new BrowserToolError('browser_denied', 'no workspace to upload from')
  const root = await realpath(cwd)
  const out: { name: string; type: string; base64: string }[] = []
  let total = 0
  for (const f of paths) {
    const abs = await realpath(isAbsolute(f) ? f : resolve(root, f)).catch(() => '')
    const rel = abs ? relative(root, abs) : '..'
    if (!abs || rel.startsWith('..') || isAbsolute(rel)) throw new BrowserToolError('browser_denied', `${f} is outside the workspace`)
    const info = await stat(abs)
    total += info.size
    if (!info.isFile() || total > MAX_UPLOAD_BYTES) throw new BrowserToolError('browser_denied', `${f} is not a file or uploads exceed 20 MB`)
    out.push({ name: basename(abs), type: '', base64: (await readFile(abs)).toString('base64') })
  }
  return out
}

async function waitText(engine: PageEngine, value: string, present: boolean, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const has = await engine.run<boolean>(`__piBrowser.pageHasText(${js(value)})`).catch(() => !present)
    if (has === present) return
    await sleep(250)
  }
  throw new BrowserToolError('browser_timeout', `waited ${timeoutMs / 1000}s for text ${js(value)} to ${present ? 'appear' : 'disappear'}`)
}

const DOWNLOAD_START_MS = 15_000
const DOWNLOAD_MAX_MS = 10 * 60_000

/** The download a click started: the first new entry, followed until it ends. */
async function waitDownload(host: AgentBrowserHost, known: Set<string>, signal?: AbortSignal): Promise<BrowserDownloadInfo> {
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new BrowserToolError('browser_error', 'stopped')
    const fresh = host.downloads().find((d) => !known.has(d.id))
    if (fresh?.state === 'completed') return fresh
    if (fresh && (fresh.state === 'failed' || fresh.state === 'cancelled')) throw new BrowserToolError('browser_error', `download ${fresh.state}${fresh.error ? `: ${fresh.error}` : ''}`)
    if (!fresh && Date.now() - started > DOWNLOAD_START_MS) throw new BrowserToolError('browser_timeout', 'the click did not start a download within 15s; the link may open a page instead (check with browser_snapshot)')
    if (Date.now() - started > DOWNLOAD_MAX_MS) throw new BrowserToolError('browser_timeout', `the download is still running after 10 min: ${fresh?.savePath ?? ''}`)
    await sleep(300)
  }
}

/** A path inside the workspace (no escaping it with .. or an absolute path elsewhere). */
async function workspacePath(p: string, cwd: string): Promise<string> {
  if (!cwd) throw new BrowserToolError('browser_denied', 'no workspace to save into')
  const root = await realpath(cwd)
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new BrowserToolError('browser_denied', `${p} is outside the workspace`)
  return abs
}

/** Per-conversation scratch folder for files the browser tools write. */
async function sessionDir(sessionKey: string): Promise<string> {
  const dir = join(tmpdir(), 'pi-desktop-browser', createHash('sha256').update(sessionKey).digest('hex').slice(0, 12))
  await mkdir(dir, { recursive: true })
  return dir
}

/** A whole snapshot written to a file: the model reads or greps it instead of carrying it in context. */
async function saveSnapshot(sessionKey: string, name: string, body: string): Promise<string> {
  const file = join(await sessionDir(sessionKey), safeFileName(name))
  await writeFile(file, body)
  const lines = body ? body.split('\n').length : 0
  const refs = (body.match(/\[ref=[^\]]+\]/g) ?? []).length
  return `### Snapshot saved\n${file} (${Math.round(Buffer.byteLength(body) / 1024)} KB, ${lines} lines, ${refs} refs). Read or grep it; its refs work with the other tools until the page changes.`
}

function safeFileName(name: string): string {
  return basename(name).replace(/[^\p{L}\p{N}._ -]+/gu, '-').trim().slice(0, 100) || 'result.json'
}

function pdfName(filename: string | undefined, title: string): string {
  const base = (filename || title || 'page').replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '-').trim().slice(0, 80) || 'page'
  return `${base}.pdf`
}

type Args = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function tabsTool(host: AgentBrowserHost, call: BrowserToolCall, a: Args): Promise<ToolResult> {
  const mine = () => sessionTabs(host.list().tabs, call.sessionKey)
  const current = currentTabId(host, call.sessionKey, false)
  const listing = () =>
    mine()
      .map((t, i) => `- ${i}:${t.tabId === currentTab.get(call.sessionKey) ? ' (current)' : ''} [${t.title || 'untitled'}](${t.url})`)
      .join('\n') || '(no tabs)'
  const pick = (): BrowserTabInfo => {
    const tabs = mine()
    const tab = a.index === undefined ? tabs.find((t) => t.tabId === current) : tabs[a.index]
    if (!tab) throw new BrowserToolError('browser_no_tab', `no tab at index ${a.index ?? '(current)'}; call browser_tabs action "list"`)
    return tab
  }
  switch (a.action) {
    case 'list': {
      const theirs = host.userTabs ? await host.userTabs().catch(() => []) : []
      const lend = theirs.length ? `\n### The user's Chrome tabs (borrow by index)\n${theirs.map((t, i) => `- ${i}: [${t.title || 'untitled'}](${t.url})`).join('\n')}` : ''
      return text(`### Open tabs\n${listing()}${lend}`)
    }
    case 'borrow': {
      if (!host.userTabs || !host.borrow) throw new BrowserToolError('browser_unsupported', "borrowing is for the user's Chrome; in the built-in browser every tab is already available")
      const theirs = await host.userTabs()
      const t = a.index !== undefined ? theirs[a.index] : undefined
      if (!t) throw new BrowserToolError('browser_no_tab', 'pass index from the "user\'s Chrome tabs" list of browser_tabs action "list"')
      const ok = await waitForHelp({
        tabId: '',
        sessionKey: call.sessionKey,
        prompt: `The AI wants to use your tab "${t.title || t.url}". Allow?`,
        timeoutSec: 120,
        where: 'chrome',
        confirm: true,
        signal: call.signal,
        emit: (event) => host.notify(event),
        url: () => '',
        hasText: async () => false,
        tabOpen: () => true,
      })
      if (ok.outcome !== 'completed') throw new BrowserToolError('browser_denied', `the user did not lend the tab (${ok.outcome}); do not ask again`)
      const info = await host.borrow(t.chromeTabId, call.sessionKey)
      currentTab.set(call.sessionKey, info.tabId)
      return text(`### Result\nBorrowed "${t.title || t.url}"; return it with browser_tabs action "return" when done.\n### Open tabs\n${listing()}`)
    }
    case 'return': {
      if (!host.giveBack) throw new BrowserToolError('browser_unsupported', 'only borrowed Chrome tabs are returned')
      const tab = pick()
      await host.giveBack(tab.tabId)
      lastSnap.delete(tab.tabId)
      if (currentTab.get(call.sessionKey) === tab.tabId) currentTab.delete(call.sessionKey)
      return text(`### Result\nReturned the tab to the user\n### Open tabs\n${listing()}`)
    }
    case 'new': {
      const url = a.url ?? 'about:blank'
      if (!isAllowedBrowserUrl(url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
      const info = await host.openTab({ url, focus: host.list().tabs.length === 0, openedBy: { sessionKey: call.sessionKey } })
      currentTab.set(call.sessionKey, info.tabId)
      if (url !== 'about:blank') await settle(host.agentTab(info.tabId).engine, 15_000)
      return text(`### Open tabs\n${listing()}`)
    }
    case 'close': {
      const tab = pick()
      host.closeTab(tab.tabId)
      lastSnap.delete(tab.tabId)
      if (currentTab.get(call.sessionKey) === tab.tabId) currentTab.delete(call.sessionKey)
      return text(`### Open tabs\n${listing()}`)
    }
    default: {
      const tab = pick()
      currentTab.set(call.sessionKey, tab.tabId)
      host.focusTab(tab.tabId)
      return text(`### Open tabs\n${listing()}`)
    }
  }
}

/** First line of a step's "### Result" section (or of its text). */
function stepSummary(result: ToolResult): string {
  const body = result.content.find((c) => c.type === 'text')?.text ?? ''
  const m = /### Result\n(.*)/.exec(body)
  return (m?.[1] ?? body.split('\n')[0] ?? '').slice(0, 200)
}

/**
 * GenericAgent-style batching: several steps in one tool call saves the model a turn (and the
 * context it re-reads) per step. Intermediate steps report one line; the last reports in full.
 */
async function batch(host: AgentBrowserHost, call: BrowserToolCall, a: Args): Promise<ToolResult> {
  const steps = a.steps as { tool: string; args?: Args }[]
  const lines: string[] = []
  let last: ToolResult | null = null
  for (const [i, step] of steps.entries()) {
    const tool = step.tool.startsWith('browser_') ? step.tool : `browser_${step.tool}`
    let result: ToolResult
    if (BROWSER_BATCH_EXCLUDED.includes(tool)) result = { content: [{ type: 'text', text: `browser_denied: ${tool} cannot run inside a batch` }], isError: true }
    else result = await executeBrowserTool(host, { ...call, tool, args: step.args ?? {}, nested: true })
    last = result
    lines.push(`${i + 1}. ${tool.replace(/^browser_/, '')}: ${result.isError ? `failed: ${stepSummary(result)}` : stepSummary(result)}`)
    if (result.isError && a.stopOnError !== false) {
      lines.push(`Stopped at step ${i + 1}; later steps did not run.`)
      break
    }
  }
  const tail = last && !last.isError ? last.content : []
  return {
    content: [{ type: 'text', text: `### Steps\n${lines.join('\n')}` }, ...tail],
    ...(last?.isError ? { isError: true } : {}),
  }
}

/** Recent requests, numbered; plus failures seen before recording started. */
function requestList(engine: PageEngine, onlyFailed: boolean): ToolResult {

  const net = engine.cdpTab()?.network
  if (!net) {
    const entries = engine.logs().filter((e) => e.kind === 'network')
    return text(entries.length ? entries.slice(-50).map((e) => e.message).join('\n') : 'No failed requests.')
  }
  const list = net.recent(50, onlyFailed)
  // Failures the browser saw before recording started (no number, no body).
  const earlier = engine.logs().filter((e) => e.kind === 'network' && !list.some((r) => e.message.includes(r.url)))
  const parts = [
    list.length ? `### Requests (browser_devtools show:"request" id=N for details)\n${list.map((e) => formatEntry(e, originOf(engine.url()))).join('\n')}` : '',
    earlier.length ? `### Failed before recording started\n${earlier.slice(-20).map((e) => e.message).join('\n')}` : '',
  ].filter(Boolean)
  return text(parts.length ? parts.join('\n') : 'No requests recorded yet.')
}

/** Headers and body of one numbered request. */
async function requestDetail(engine: PageEngine, id: number | undefined): Promise<ToolResult> {
  if (!id) throw new BrowserToolError('browser_denied', 'pass id (the #number from a Network section or show:"requests")')

  const cdp = requireCdp(engine, 'request details')
  const e = cdp.network.get(id)
  if (!e) throw new BrowserToolError('browser_not_found', `no request #${id} (only the last 300 are kept); call browser_devtools show:"requests"`)
  let body = '(not available: still loading, a redirect, or the page dropped it)'
  if (e.done && !e.failed) {
    const b = await cdp.body(e.requestId, e.sessionId).catch(() => null)
    if (b) body = b.base64 ? `(binary, ${Math.round((b.text.length * 3) / 4 / 1024)} KB${e.mime ? `, ${e.mime}` : ''})` : b.text.length > 20_000 ? `${b.text.slice(0, 20_000)}… (${b.text.length} chars in all)` : b.text || '(empty)'
  }
  return text(
    [
      `### Request ${formatEntry(e)}`,
      `Type: ${e.type}${e.mime ? ` · ${e.mime}` : ''}${e.size !== undefined ? ` · ${Math.round(e.size / 1024)} KB` : ''}`,
      `### Request headers\n${redactHeaders(e.requestHeaders)}`,
      e.postData ? `### Request body\n${e.postData}` : '',
      `### Response headers\n${redactHeaders(e.responseHeaders)}`,
      `### Response body\n${body}`,
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

async function execute(host: AgentBrowserHost, call: BrowserToolCall): Promise<ToolResult> {
  const def = DEFS.get(call.tool)
  if (!def) throw new BrowserToolError('browser_denied', `unknown tool ${call.tool}`)
  // `element` is a Playwright MCP habit (a label for permission prompts); accept and ignore it.
  if (call.args && typeof call.args === 'object') delete (call.args as Record<string, unknown>).element
  if (call.args && typeof call.args === 'object' && (call.args as Args).fields) {
    for (const f of (call.args as Args).fields as Args[]) if (f && typeof f === 'object') delete f.element
  }
  const problems = checkArgs(def.parameters, call.args ?? {})
  if (problems.length) throw new BrowserToolError('browser_denied', problems.join('; '))
  const a = (call.args ?? {}) as Args

  if (call.tool === 'browser_tabs') return tabsTool(host, call, a)
  if (call.tool === 'browser_batch') return batch(host, call, a)

  if (call.tool === 'browser_navigate' && a.url !== 'back') {
    if (!isAllowedBrowserUrl(a.url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
    let id = currentTabId(host, call.sessionKey, false)
    if (!id) {
      id = (await host.openTab({ focus: host.list().tabs.length === 0, openedBy: { sessionKey: call.sessionKey } })).tabId
      currentTab.set(call.sessionKey, id)
    }
    const { engine } = host.agentTab(id)
    return host.runOnTab(id, 'navigate', async () => {
      // Start recording (requests, dialogs) before the page loads, not after.
      await Promise.race([engine.cdpTab()?.start().catch(() => undefined), sleep(3000)])
      await engine.navigate(a.url)
      await settle(engine, 15_000)
      const snap = await takeSnapshot(id, engine)
      return text([pageSection(engine), `### Snapshot (interactive elements)\n${outline(snap)}`, snapshotNotes(snap, id)].filter(Boolean).join('\n'))
    })
  }

  const id = currentTabId(host, call.sessionKey)!
  const { engine, pointer } = host.agentTab(id)
  const tool = call.tool.replace(/^browser_/, '')

  switch (call.tool) {
    case 'browser_navigate': // url "back"
      return host.runOnTab(id, 'back', () =>
        act(id, engine, async () => {
          if (!(await engine.back())) throw new BrowserToolError('browser_denied', 'no previous page')
          await settle(engine, 15_000)
          return 'Went back'
        }),
      )
    case 'browser_snapshot':
      return host.runOnTab(id, tool, async () => {
        if (a.mode === 'text') {
          const t = unwrap(await engine.run<{ text: string; truncated: boolean; chars: number } | RuntimeError>(`__piBrowser.textView(${js({ target: a.target, maxChars: a.saveTo ? RAW_MAX_CHARS : SNAPSHOT_MAX_CHARS })})`, 8000))
          lastSnap.delete(id)
          if (a.saveTo) return text(`${pageSection(engine)}\n${await saveSnapshot(call.sessionKey, a.saveTo, t.text)}`)
          const note = t.truncated ? `\nText truncated (${t.chars} chars in all): use target=<ref> for one region, query="…", or saveTo for all of it in a file.` : ''
          return text(`${pageSection(engine)}\n### Text\n${t.text || '(no text)'}${note}`)
        }
        if (a.query) {
          // Search the whole (unfolded) snapshot: folded and cut items are found too.
          const q = String(a.query)
          const res = unwrap(await engine.run<{ matches: string; count: number } | RuntimeError>(`__piBrowser.find(${js(/^\/.+\/[a-z]*$/s.test(q) ? { regex: q } : { text: q })})`, 8000))
          return text(res.count ? `### Matches (${res.count}${res.count >= 20 ? '+' : ''})\n${res.matches}` : `No lines match ${js(q)}.`)
        }
        const raw = await takeSnapshot(id, engine, { target: a.target, depth: a.depth })
        if (a.saveTo) {
          const saved = await saveSnapshot(call.sessionKey, a.saveTo, shapeSnapshot(raw.yaml, { origin: originOf(raw.url), fold: false }).yaml)
          return text([pageSection(engine), saved, snapshotNotes({ ...raw, truncated: false }, id)].filter(Boolean).join('\n'))
        }
        const snap = shaped(raw, { target: a.target })
        const hover = a.probeHover ? await probeHover(id, engine, pointer, raw) : ''
        return text([pageSection(engine), `### Snapshot\n\`\`\`yaml\n${snap.yaml || '(empty page)'}\n\`\`\``, hover, snapshotNotes(snap, id)].filter(Boolean).join('\n'))
      })
    case 'browser_click':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          if (!a.target) {
            if (a.x === undefined || a.y === undefined) throw new BrowserToolError('browser_denied', 'pass target, or x and y from the last screenshot')
            const shot = lastShot.get(id)
            if (!shot) throw new BrowserToolError('browser_denied', 'x/y refer to a screenshot: call browser_take_screenshot (viewport or target) first')
            if (a.x > shot.width || a.y > shot.height) throw new BrowserToolError('browser_denied', `x/y are outside the ${shot.width}×${shot.height} screenshot`)
            const cx = shot.originX + a.x / shot.scale
            const cy = shot.originY + a.y / shot.scale
            await pointer.click(cx, cy, { button: a.button, clickCount: a.doubleClick ? 2 : 1, modifiers: toModifiers(a.modifiers) })
            lastShot.delete(id)
            return `${a.doubleClick ? 'Double-clicked' : 'Clicked'} at (${Math.round(cx)}, ${Math.round(cy)}) CSS px`
          }
          if (await scopeOf(engine, a.target).run<boolean>(`__piBrowser.isFileTarget(${js(a.target)})`)) {
            throw new BrowserToolError('browser_denied', 'this opens a file chooser; use browser_file_upload with the same target instead')
          }
          const probe = await actionable(engine, a.target)
          if (probe.tag === 'select') throw new BrowserToolError('browser_denied', 'this is a <select>; use browser_select_option')
          const { ptr, p } = aim(pointer, probe)
          await ptr.click(p.x, p.y, { button: a.button, clickCount: a.doubleClick ? 2 : 1, modifiers: toModifiers(a.modifiers) })
          return `${a.doubleClick ? 'Double-clicked' : 'Clicked'} ${probe.description}`
        }),
      )
    case 'browser_hover':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const probe = await actionable(engine, a.target)
          const { ptr, p } = aim(pointer, probe)
          await ptr.moveTo(p.x, p.y)
          return `Hovered ${probe.description}`
        }),
      )
    case 'browser_drag':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const from = await actionable(engine, a.startTarget)
          const to = await actionable(engine, a.endTarget)
          await pointer.drag(targetPoint(from.point, from.rect), targetPoint(to.point, to.rect))
          return `Dragged ${from.description} to ${to.description}`
        }),
      )
    case 'browser_type':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const what = await typeInto(engine, pointer, a.target, a.text, { append: a.slowly, submit: a.submit })
          return `Typed ${a.text.length} character(s) into ${what}${a.submit ? ' and pressed Enter' : ''}`
        }),
      )
    case 'browser_fill_form':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const done: string[] = []
          for (const f of a.fields as { target: string; name?: string; type: string; value: string }[]) {
            if (f.type === 'textbox') done.push(await typeInto(engine, pointer, f.target, f.value))
            else if (f.type === 'checkbox' || f.type === 'radio') {
              const want = f.value === 'true'
              const probe = await actionable(engine, f.target)
              if ((probe.checked === true) !== want && (want || f.type === 'checkbox')) {
                const { ptr, p } = aim(pointer, probe)
                await ptr.click(p.x, p.y)
              }
              done.push(probe.description)
            } else if (f.type === 'combobox') {
              const probe = await actionable(engine, f.target)
              if (probe.tag === 'select') unwrap(await scopeOf(engine, f.target).run<unknown>(`__piBrowser.selectOptions(${js(f.target)}, ${js([f.value])})`))
              else await typeInto(engine, pointer, f.target, f.value)
              done.push(probe.description)
            } else {
              unwrap(await scopeOf(engine, f.target).run<unknown>(`__piBrowser.setRangeValue(${js(f.target)}, ${js(f.value)})`))
              done.push(f.name ?? f.target)
            }
            await sleep(80 + Math.random() * 120)
          }
          return `Filled ${done.length} field(s): ${done.join(', ')}`
        }),
      )
    case 'browser_select_option':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const probe = await actionable(engine, a.target)
          const res = unwrap(await scopeOf(engine, a.target).run<{ selected: string[] } | RuntimeError>(`__piBrowser.selectOptions(${js(a.target)}, ${js(a.values)})`))
          return `Selected ${res.selected.map((v) => js(v)).join(', ')} in ${probe.description}`
        }),
      )
    case 'browser_press_key':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          await engine.keyboard.press(a.key)
          return `Pressed ${a.key}`
        }),
      )
    case 'browser_mouse_wheel':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          let at = { x: 0, y: 0 }
          if (a.target) {
            const probe = await actionable(engine, a.target, { force: true })
            at = targetPoint(probe.point, probe.rect)
          } else {
            const [w, h] = await engine.run<[number, number]>('[innerWidth, innerHeight]')
            at = { x: Math.round(w / 2 + (Math.random() - 0.5) * w * 0.2), y: Math.round(h / 2 + (Math.random() - 0.5) * h * 0.2) }
          }
          await pointer.wheel(at.x, at.y, a.deltaX ?? 0, a.deltaY)
          await sleep(200)
          return `Scrolled ${a.deltaY > 0 ? 'down' : 'up'} ${Math.abs(a.deltaY)}px`
        }),
      )
    case 'browser_file_upload':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const files = await readUploads(a.paths, call.cwd)
          const fn = a.mode === 'drop' ? 'dropFiles' : 'setFiles'
          const res = unwrap(await scopeOf(engine, a.target).run<{ count: number } | RuntimeError>(`__piBrowser.${fn}(${js(a.target)}, ${js(files)})`, 15_000))
          return `${a.mode === 'drop' ? 'Dropped' : 'Set'} ${res.count} file(s): ${files.map((f) => f.name).join(', ')}`
        }),
      )
    case 'browser_take_screenshot':
      return host.runOnTab(id, tool, async () => {
        if (a.fullPage) {
          const cdp = requireCdp(engine, 'full-page screenshots')
          const note = a.scope === 'follow' ? await followLazyContent(engine) : ''
          const shot = await cdp.fullPage()
          lastShot.delete(id)
          const extra = [shot.clipped ? 'cut at 16384 CSS px' : '', note].filter(Boolean).join('; ')
          return {
            content: [
              { type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: `${pageSection(engine)}\nFull-page screenshot ${shot.width}×${shot.height}${extra ? ` (${extra})` : ''}` },
            ],
          }
        }
        const clip = a.target ? (await actionable(engine, a.target, { force: true })).rect : undefined
        const shot = await engine.screenshot({ clip })
        const [vw] = await engine.run<[number, number]>('[innerWidth, innerHeight]').catch(() => [shot.width, shot.height] as [number, number])
        const cssWidth = clip ? clip.width : vw
        // Remember the mapping so browser_click {x, y} can use pixels from this image.
        lastShot.set(id, { scale: shot.width / Math.max(1, cssWidth), originX: clip?.x ?? 0, originY: clip?.y ?? 0, width: shot.width, height: shot.height })
        return {
          content: [
            { type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `${pageSection(engine)}\nScreenshot ${shot.width}×${shot.height}${a.target ? ` of ${a.target}` : ''}; browser_click accepts x/y in these image pixels` },
          ],
        }
      })
    case 'browser_site_notes': {
      const siteHost = a.host ?? hostKey(engine.url())
      if (!siteHost) throw new BrowserToolError('browser_denied', 'the current page is not a website; pass host')
      if (a.action === 'append') {
        if (!a.text) throw new BrowserToolError('browser_denied', 'pass text to append')
        await appendSiteNote(siteHost, a.text)
        return text(`### Result\nNoted for ${siteHost}`)
      }
      const notes = await readSiteNotes(siteHost)
      return text(notes ? `### Site notes (${siteHost})\n${notes}` : `No notes for ${siteHost} yet.`)
    }
    case 'browser_request_help': {
      // Not on the tab's action queue: this waits minutes for the user, not for the page.
      let description: string | undefined
      if (a.target) {
        const probe = await actionable(engine, a.target, { force: true }).catch(() => null)
        if (probe) {
          description = probe.description
          await engine.cdpTab()?.highlight(probe.rect).catch(() => undefined)
        }
      }
      host.focusTab(id, { window: true })
      const { outcome, reason } = await waitForHelp({
        tabId: id,
        sessionKey: call.sessionKey,
        prompt: a.prompt,
        target: description,
        until: a.until,
        timeoutSec: a.timeoutSec ?? 600,
        where: host.kind,
        signal: call.signal,
        emit: (event) => host.notify(event),
        url: () => engine.url(),
        hasText: (t) => engine.run<boolean>(`__piBrowser.pageHasText(${js(t)})`),
        tabOpen: () => host.list().tabs.some((t) => t.tabId === id),
      })
      await engine.cdpTab()?.highlight(null).catch(() => undefined)
      lastSnap.delete(id)
      const advice = outcome === 'cancelled' || outcome === 'timed_out' ? '\nDo not ask again for this step: try another way or tell the user what is blocked.' : ''
      if (outcome === 'aborted' || !host.list().tabs.some((t) => t.tabId === id)) return text(`### Result\nHelp ${outcome}${reason ? ` (${reason})` : ''}${advice}`)
      const after = await takeSnapshot(id, engine).catch(() => null)
      return text([`### Result\nHelp ${outcome}${reason ? ` (${reason})` : ''}${advice}`, pageSection(engine), after ? `### Snapshot (interactive elements)\n${outline(after)}` : ''].filter(Boolean).join('\n'))
    }
    case 'browser_download':
      return host.runOnTab(id, tool, async () => {
        const known = new Set(host.downloads().map((d) => d.id))
        const probe = await actionable(engine, a.target)
        const { ptr, p } = aim(pointer, probe)
        await ptr.click(p.x, p.y)
        const done = await waitDownload(host, known, call.signal)
        let path = done.savePath
        if (a.saveAs) {
          path = await workspacePath(a.saveAs, call.cwd)
          await mkdir(dirname(path), { recursive: true })
          await copyFile(done.savePath, path)
        }
        return text(`### Result\nDownloaded ${done.fileName} (${Math.round(done.received / 1024)} KB) via ${done.via}: ${path}\n${pageSection(engine)}`)
      })
    case 'browser_cdp':
      return host.runOnTab(id, tool, async () => {
        const cdp = requireCdp(engine, 'raw DevTools commands')
        if (/^(Runtime|Console)\.enable$/.test(a.method)) throw new BrowserToolError('browser_denied', `${a.method} is refused: pages can detect it`)
        const frameId = a.target ? scopeOf(engine, a.target).frameId ?? undefined : undefined
        const res = await cdp.raw(a.method, a.params ?? {}, frameId).catch((error: Error) => {
          throw new BrowserToolError('browser_error', `${a.method}: ${error.message}`)
        })
        const out = JSON.stringify(res ?? null)
        return text(out.length > 20_000 ? `${out.slice(0, 20_000)}… (${out.length} chars; narrow the request, e.g. a smaller depth)` : out)
      })
    case 'browser_emulate':
      return host.runOnTab(id, tool, async () => {
        const cdp = requireCdp(engine, 'device emulation')
        await cdp.emulate(a.device === 'off' ? null : a.device, () => engine.run<string>('navigator.userAgent'))
        lastSnap.delete(id)
        await settle(engine)
        return text(`### Result\n${a.device === 'off' ? 'Emulation off' : `Emulating ${a.device}`} (reload if the site sniffs the device at load)\n${pageSection(engine)}`)
      })
    case 'browser_wait_for': {
      if (a.time === undefined && !a.text && !a.textGone) throw new BrowserToolError('browser_denied', 'pass text, textGone or time')
      if (a.time) await sleep(a.time * 1000)
      if (a.text) await waitText(engine, a.text, true, 15_000)
      if (a.textGone) await waitText(engine, a.textGone, false, 15_000)
      return text(`### Result\nWaited${a.text ? ` for ${js(a.text)}` : ''}${a.textGone ? ` until ${js(a.textGone)} was gone` : ''}${a.time ? ` ${a.time}s` : ''}\n${pageSection(engine)}`)
    }
    case 'browser_devtools': {
      if (a.show === 'request') return requestDetail(engine, a.id)
      if (a.show === 'requests') return requestList(engine, !!a.onlyFailed)
      const entries = engine.logs().filter((e) => e.kind === 'console' && (!a.onlyFailed || e.level === 'error'))
      return text(entries.length ? entries.slice(-50).map((e) => `[${e.level}] ${e.message}${e.source ? ` @ ${e.source}` : ''}`).join('\n') : 'No console errors or warnings.')
    }
    case 'browser_evaluate':
      return host.runOnTab(id, tool, async () => {
        const evaluate = async (): Promise<string> => {
          let res: { value?: unknown; __error?: RuntimeError }
          if (a.world === 'main') {
            const scope = scopeOf(engine, a.target)
            const selector = a.target ? unwrap(await scope.run<{ selector: string } | RuntimeError>(`__piBrowser.selectorOf(${js(a.target)})`)).selector : null
            const code = mainWorldEval(a.function, selector)
            res = scope.frameId ? await requireCdp(engine, 'frames').runMain(code, 10_000, scope.frameId) : await engine.runMain(code, 10_000)
          } else {
            // Isolated world: shares the DOM with the page, not its JavaScript globals.
            res = await scopeOf(engine, a.target).run(
              `(async () => {
                const target = ${js(a.target ?? null)};
                const el = target ? __piBrowser.resolveElement(target) : undefined;
                if (el && el.error) return { __error: el };
                const value = await (${a.function})(el);
                return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
              })()`,
              10_000,
            )
          }
          if (res?.__error) unwrap(res.__error)
          const value = res?.value ?? null
          if (a.saveTo) {
            const file = join(await sessionDir(call.sessionKey), safeFileName(a.saveTo))
            const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
            await writeFile(file, body)
            return `Saved ${Math.round(Buffer.byteLength(body) / 1024)} KB: ${file}`
          }
          const out = JSON.stringify(value)
          return out.length > 20_000 ? `${out.slice(0, 20_000)}… (truncated; pass saveTo for the full result)` : out
        }
        if (a.watch) return act(id, engine, evaluate)
        return text(a.saveTo ? `### Result\n${await evaluate()}` : await evaluate())
      })
    case 'browser_handle_dialog': {
      if (!engine.dialog) {
        throw new BrowserToolError('browser_unsupported', 'this browser cannot answer page dialogs; ask the user to close the dialog in the Browser panel, then continue')
      }
      if (!engine.dialog.pending()) return text('No dialog is open.')
      await engine.dialog.handle(a.accept, a.promptText)
      return text(`### Result\n${a.accept ? 'Accepted' : 'Dismissed'} the dialog\n${pageSection(engine)}`)
    }
    case 'browser_pdf_save':
      return host.runOnTab(id, tool, async () => {
        const data = await engine.pdf()
        const file = join(await sessionDir(call.sessionKey), pdfName(a.filename, engine.title()))
        await writeFile(file, data)
        return text(`### Result\nSaved PDF (${Math.round(data.length / 1024)} KB): ${file}`)
      })
    default:
      throw new BrowserToolError('browser_denied', `unknown tool ${call.tool}`)
  }
}

/** Run one agent tool call; errors come back as tool errors the model can read and act on. */
export async function executeBrowserTool(host: AgentBrowserHost, call: BrowserToolCall): Promise<ToolResult> {
  try {
    const result = await execute(host, call)
    if (!result.isError && !call.nested && call.tool !== 'browser_site_notes') {
      // First visit of a site in this conversation: hand over what earlier runs learned there.
      const id = currentTab.get(call.sessionKey)
      const url = id ? (() => { try { return host.agentTab(id).engine.url() } catch { return '' } })() : ''
      const section = url ? await siteNotesSection(call.sessionKey, url).catch(() => '') : ''
      if (section) result.content.push({ type: 'text', text: section })
    }
    return result
  } catch (error) {
    const message = error instanceof BrowserToolError ? error.message : `browser_error: ${(error as Error)?.message ?? String(error)}`
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

/** Forget per-tab state (tab closed by the user). */
export function forgetBrowserTab(tabId: string): void {
  lastSnap.delete(tabId)
  hintsShown.delete(tabId)
  for (const [key, id] of currentTab) if (id === tabId) currentTab.delete(key)
}
