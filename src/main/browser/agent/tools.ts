// Executes browser_* tool calls against a tab's PageEngine. Engine-agnostic: everything here
// goes through PageEngine + the page runtime (`__piBrowser`), so engine S reuses it unchanged.
// Results follow Playwright MCP's sections, kept short: what happened, where we are, what changed.

import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { BROWSER_TOOL_DEFS, checkArgs } from '@shared/browser-tools'
import { isAllowedBrowserUrl, type BrowserTabInfo } from '@shared/browser-types'
import type { Modifier, PageEngine } from '../engines/types'
import { BrowserToolError, unwrap, type RuntimeError } from './errors'
import { Pointer, targetPoint, typeText } from './input'
import { compactSnapshot, diffSnapshots } from './snapshot-diff'

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
}

/** What the executor needs from the browser host (BrowserHost implements it). */
export interface AgentBrowserHost {
  list(): { tabs: BrowserTabInfo[]; activeTabId: string | null }
  openTab(opts: { url?: string; focus?: boolean; openedBy?: BrowserTabInfo['openedBy'] }): BrowserTabInfo
  closeTab(tabId: string): void
  focusTab(tabId: string): void
  agentTab(tabId: string): { info: BrowserTabInfo; engine: PageEngine; pointer: Pointer }
  runOnTab<T>(tabId: string, action: string, work: () => Promise<T>): Promise<T>
}

interface Snap {
  url: string
  title: string
  yaml: string
  truncated: boolean
  refCount: number
  belowFold: { count: number; screens: number }
  covered: number
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

const SNAPSHOT_MAX_CHARS = 40_000
const BASELINE_MAX_AGE_MS = 5000
const ACTION_TIMEOUT_MS = 5000
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const DEFS = new Map(BROWSER_TOOL_DEFS.map((d) => [d.name, d]))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const js = (v: unknown) => JSON.stringify(v)
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })

/** Latest snapshot per tab: the "before" side of the next action's diff. */
const lastSnap = new Map<string, Snap & { at: number }>()
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
  const snap = unwrap(await engine.run<Snap | RuntimeError>(`__piBrowser.snapshot(${js({ ...opts, maxChars: SNAPSHOT_MAX_CHARS })})`, 8000))
  if (!opts.target && !opts.depth) lastSnap.set(tabId, { ...snap, at: Date.now() })
  return snap
}

function pageSection(engine: PageEngine, prevUrl?: string): string {
  const url = engine.url()
  const moved = prevUrl !== undefined && prevUrl !== url
  return `### Page\nURL: ${url}${moved ? ' (changed)' : ''}\nTitle: ${engine.title() || '(untitled)'}`
}

function snapshotNotes(snap: Snap): string {
  const notes: string[] = []
  if (snap.covered) notes.push(`${snap.covered} element(s) are covered by an overlay and have no ref; deal with the overlay first.`)
  if (snap.belowFold.count) notes.push(`${snap.belowFold.count} more interactive element(s) below the visible area (about ${snap.belowFold.screens} screen(s)); they keep their refs.`)
  if (snap.truncated) notes.push('Snapshot truncated: use target=<ref> for one region or browser_find.')
  return notes.join('\n')
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
  const summary = await done()
  await settle(engine)
  const parts = [`### Result\n${summary}`, pageSection(engine, beforeUrl)]
  let after: Snap | null = null
  try {
    after = await takeSnapshot(tabId, engine)
  } catch (error) {
    if (error instanceof BrowserToolError && error.code === 'browser_dialog_pending') {
      parts.push('### Modal state\nA dialog (alert/confirm/prompt) is blocking the page. Call browser_handle_dialog.')
      return text(parts.join('\n'))
    }
    throw error
  }
  if (after.url !== before?.url) parts.push(`### Snapshot (new page, interactive elements)\n${compactSnapshot(after.yaml) || '(no interactive elements)'}`)
  else parts.push(`### Changes\n${(before && diffSnapshots(before.yaml, after.yaml)) ?? 'none'}`)
  const notes = snapshotNotes(after)
  if (notes) parts.push(notes)
  return text(parts.join('\n'))
}

async function actionable(engine: PageEngine, target: string, opts: { force?: boolean } = {}): Promise<Actionable> {
  return unwrap(
    await engine.run<Actionable | RuntimeError>(`__piBrowser.actionable(${js(target)}, ${js({ ...opts, timeoutMs: ACTION_TIMEOUT_MS })})`, ACTION_TIMEOUT_MS + 2000),
  )
}

async function clickTarget(engine: PageEngine, pointer: Pointer, target: string, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number; modifiers?: Modifier[] } = {}): Promise<Actionable> {
  const a = await actionable(engine, target)
  const p = targetPoint(a.point, a.rect)
  await pointer.click(p.x, p.y, opts)
  return a
}

async function typeInto(engine: PageEngine, pointer: Pointer, target: string, value: string, opts: { append?: boolean; submit?: boolean } = {}): Promise<string> {
  const a = await clickTarget(engine, pointer, target)
  unwrap(await engine.run<unknown>(`__piBrowser.prepareInput(${js(target)}, ${js({ keep: !!opts.append })})`))
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
    case 'list':
      return text(`### Open tabs\n${listing()}`)
    case 'new': {
      const url = a.url ?? 'about:blank'
      if (!isAllowedBrowserUrl(url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
      const info = host.openTab({ url, focus: host.list().tabs.length === 0, openedBy: { sessionKey: call.sessionKey } })
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

  if (call.tool === 'browser_navigate') {
    if (!isAllowedBrowserUrl(a.url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
    let id = currentTabId(host, call.sessionKey, false)
    if (!id) {
      id = host.openTab({ focus: host.list().tabs.length === 0, openedBy: { sessionKey: call.sessionKey } }).tabId
      currentTab.set(call.sessionKey, id)
    }
    const { engine } = host.agentTab(id)
    return host.runOnTab(id, 'navigate', async () => {
      await engine.navigate(a.url)
      await settle(engine, 15_000)
      const snap = await takeSnapshot(id, engine)
      return text([pageSection(engine), `### Snapshot (interactive elements)\n${compactSnapshot(snap.yaml) || '(no interactive elements)'}`, snapshotNotes(snap)].filter(Boolean).join('\n'))
    })
  }

  const id = currentTabId(host, call.sessionKey)!
  const { engine, pointer } = host.agentTab(id)
  const tool = call.tool.replace(/^browser_/, '')

  switch (call.tool) {
    case 'browser_navigate_back':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          if (!(await engine.back())) throw new BrowserToolError('browser_denied', 'no previous page')
          await settle(engine, 15_000)
          return 'Went back'
        }),
      )
    case 'browser_snapshot':
      return host.runOnTab(id, tool, async () => {
        const snap = await takeSnapshot(id, engine, { target: a.target, depth: a.depth, boxes: a.boxes })
        return text([pageSection(engine), `### Snapshot\n\`\`\`yaml\n${snap.yaml || '(empty page)'}\n\`\`\``, snapshotNotes(snap)].filter(Boolean).join('\n'))
      })
    case 'browser_find': {
      if (!a.text === !a.regex) throw new BrowserToolError('browser_denied', 'pass exactly one of text or regex')
      return host.runOnTab(id, tool, async () => {
        const res = unwrap(await engine.run<{ matches: string; count: number } | RuntimeError>(`__piBrowser.find(${js({ text: a.text, regex: a.regex })})`, 8000))
        return text(res.count ? `### Matches (${res.count}${res.count >= 20 ? '+' : ''})\n${res.matches}` : 'No matches.')
      })
    }
    case 'browser_click':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          if (await engine.run<boolean>(`__piBrowser.isFileTarget(${js(a.target)})`)) {
            throw new BrowserToolError('browser_denied', 'this opens a file chooser; use browser_file_upload with the same target instead')
          }
          const probe = await actionable(engine, a.target)
          if (probe.tag === 'select') throw new BrowserToolError('browser_denied', 'this is a <select>; use browser_select_option')
          const p = targetPoint(probe.point, probe.rect)
          await pointer.click(p.x, p.y, { button: a.button, clickCount: a.doubleClick ? 2 : 1, modifiers: toModifiers(a.modifiers) })
          return `${a.doubleClick ? 'Double-clicked' : 'Clicked'} ${probe.description}`
        }),
      )
    case 'browser_hover':
      return host.runOnTab(id, tool, () =>
        act(id, engine, async () => {
          const probe = await actionable(engine, a.target)
          const p = targetPoint(probe.point, probe.rect)
          await pointer.moveTo(p.x, p.y)
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
                const p = targetPoint(probe.point, probe.rect)
                await pointer.click(p.x, p.y)
              }
              done.push(probe.description)
            } else if (f.type === 'combobox') {
              const probe = await actionable(engine, f.target)
              if (probe.tag === 'select') unwrap(await engine.run<unknown>(`__piBrowser.selectOptions(${js(f.target)}, ${js([f.value])})`))
              else await typeInto(engine, pointer, f.target, f.value)
              done.push(probe.description)
            } else {
              unwrap(await engine.run<unknown>(`__piBrowser.setRangeValue(${js(f.target)}, ${js(f.value)})`))
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
          const res = unwrap(await engine.run<{ selected: string[] } | RuntimeError>(`__piBrowser.selectOptions(${js(a.target)}, ${js(a.values)})`))
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
          const res = unwrap(await engine.run<{ count: number } | RuntimeError>(`__piBrowser.setFiles(${js(a.target)}, ${js(files)})`, 15_000))
          return `Set ${res.count} file(s): ${files.map((f) => f.name).join(', ')}`
        }),
      )
    case 'browser_take_screenshot':
      return host.runOnTab(id, tool, async () => {
        if (a.fullPage) throw new BrowserToolError('browser_unsupported', 'full-page screenshots are not available here; scroll with browser_mouse_wheel and take more screenshots')
        const clip = a.target ? (await actionable(engine, a.target, { force: true })).rect : undefined
        const shot = await engine.screenshot({ clip })
        return {
          content: [
            { type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `${pageSection(engine)}\nScreenshot ${shot.width}×${shot.height}${a.target ? ` of ${a.target}` : ''}` },
          ],
        }
      })
    case 'browser_wait_for': {
      if (a.time === undefined && !a.text && !a.textGone) throw new BrowserToolError('browser_denied', 'pass text, textGone or time')
      if (a.time) await sleep(a.time * 1000)
      if (a.text) await waitText(engine, a.text, true, 15_000)
      if (a.textGone) await waitText(engine, a.textGone, false, 15_000)
      return text(`### Result\nWaited${a.text ? ` for ${js(a.text)}` : ''}${a.textGone ? ` until ${js(a.textGone)} was gone` : ''}${a.time ? ` ${a.time}s` : ''}\n${pageSection(engine)}`)
    }
    case 'browser_console_messages': {
      const entries = engine.logs().filter((e) => e.kind === 'console' && (!a.onlyErrors || e.level === 'error'))
      return text(entries.length ? entries.slice(-50).map((e) => `[${e.level}] ${e.message}${e.source ? ` @ ${e.source}` : ''}`).join('\n') : 'No console errors or warnings.')
    }
    case 'browser_network_requests': {
      const entries = engine.logs().filter((e) => e.kind === 'network')
      return text(entries.length ? entries.slice(-50).map((e) => e.message).join('\n') : 'No failed requests.')
    }
    case 'browser_evaluate':
      return host.runOnTab(id, tool, async () => {
        // Isolated world: shares the DOM with the page, not its JavaScript globals.
        const code = `(async () => {
          const target = ${js(a.target ?? null)};
          const el = target ? __piBrowser.resolveElement(target) : undefined;
          if (el && el.error) return { __error: el };
          const value = await (${a.function})(el);
          return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
        })()`
        const res = await engine.run<{ value?: unknown; __error?: RuntimeError }>(code, 10_000)
        if (res?.__error) unwrap(res.__error)
        const out = JSON.stringify(res?.value ?? null)
        return text(out.length > 20_000 ? `${out.slice(0, 20_000)}… (truncated)` : out)
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
        const dir = join(tmpdir(), 'pi-desktop-browser', createHash('sha256').update(call.sessionKey).digest('hex').slice(0, 12))
        await mkdir(dir, { recursive: true })
        const file = join(dir, pdfName(a.filename, engine.title()))
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
    return await execute(host, call)
  } catch (error) {
    const message = error instanceof BrowserToolError ? error.message : `browser_error: ${(error as Error)?.message ?? String(error)}`
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

/** Forget per-tab state (tab closed by the user). */
export function forgetBrowserTab(tabId: string): void {
  lastSnap.delete(tabId)
  for (const [key, id] of currentTab) if (id === tabId) currentTab.delete(key)
}
