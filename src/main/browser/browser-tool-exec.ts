import { z } from 'zod'
import { isAllowedBrowserUrl } from '@shared/browser-types'
import type { BrowserHost } from './browser-host'
import {
  BrowserToolError,
  actionable,
  centerOf,
  focusAndSelect,
  inPage,
  pressKey,
  selectOption,
  settle,
  snapshot,
  typeText,
  uploadFiles,
  waitFor,
} from './browser-agent'

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

const tabId = z.string().min(1).max(64).optional()
const ref = z.string().regex(/^e\d{1,7}$/, 'refs look like e12 and come from browser_snapshot')

const schemas = {
  browser_tabs: z.object({ action: z.enum(['list', 'new', 'close', 'focus']), tabId, url: z.string().max(8192).optional() }),
  browser_navigate: z.object({ tabId, url: z.string().max(8192).optional(), history: z.enum(['back', 'forward', 'reload']).optional() }),
  browser_snapshot: z.object({ tabId, scope: ref.optional(), maxChars: z.number().int().min(2000).max(120_000).optional() }),
  browser_screenshot: z.object({ tabId }),
  browser_act: z.object({
    tabId,
    action: z.enum(['click', 'dblclick', 'rightclick', 'hover', 'fill', 'type', 'press', 'select', 'scroll', 'drag', 'upload']),
    ref: ref.optional(),
    value: z.string().max(20_000).optional(),
    key: z.string().max(40).optional(),
    deltaY: z.number().finite().min(-20_000).max(20_000).optional(),
    targetRef: ref.optional(),
    files: z.array(z.string().max(4096)).max(10).optional(),
  }),
  browser_wait: z.object({ tabId, text: z.string().max(500).optional(), url: z.string().max(2000).optional(), timeoutMs: z.number().int().min(100).max(30_000).optional() }),
  browser_logs: z.object({ tabId, max: z.number().int().min(1).max(200).optional() }),
  browser_eval: z.object({ tabId, function: z.string().min(1).max(20_000), ref: ref.optional() }),
} as const

export const BROWSER_TOOL_NAMES = Object.keys(schemas) as (keyof typeof schemas)[]

const text = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] })
const tabSummary = (host: BrowserHost, id: string) => {
  const { info } = host.agentTab(id)
  return { tabId: id, url: info.url, title: info.title }
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === '') throw new BrowserToolError('browser_denied', `${what} is required for this action`)
  return value
}

async function execute(host: BrowserHost, call: BrowserToolCall): Promise<ToolResult> {
  const schema = schemas[call.tool as keyof typeof schemas]
  if (!schema) throw new BrowserToolError('browser_denied', `unknown tool ${call.tool}`)
  const parsed = schema.safeParse(call.args ?? {})
  if (!parsed.success) throw new BrowserToolError('browser_denied', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const a = parsed.data as Record<string, unknown> & { tabId?: string }

  if (call.tool === 'browser_tabs') {
    const args = a as unknown as z.infer<typeof schemas.browser_tabs>
    if (args.action === 'list') {
      const { tabs, activeTabId } = host.list()
      return text({ tabs: tabs.map((t) => ({ tabId: t.tabId, url: t.url, title: t.title, shown: t.tabId === activeTabId })) })
    }
    if (args.action === 'new') {
      const url = args.url ?? 'about:blank'
      if (!isAllowedBrowserUrl(url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
      const hasTabs = host.list().tabs.length > 0
      const info = host.openTab({ url, focus: !hasTabs, openedBy: { sessionKey: call.sessionKey } })
      if (url !== 'about:blank') await settle(host.agentTab(info.tabId).wc, 15_000)
      return text(tabSummary(host, info.tabId))
    }
    const id = host.resolveTabId(need(args.tabId, 'tabId'))
    if (args.action === 'close') host.closeTab(id)
    else host.focusTab(id)
    return text({ ok: true })
  }

  const id = host.resolveTabId(a.tabId)
  const { wc, pointer } = host.agentTab(id)

  switch (call.tool) {
    case 'browser_navigate': {
      const args = a as unknown as z.infer<typeof schemas.browser_navigate>
      return host.runOnTab(id, 'navigate', async () => {
        if (args.url) {
          if (!isAllowedBrowserUrl(args.url)) throw new BrowserToolError('browser_denied', 'only http(s) URLs can be opened')
          await host.navigate(id, { url: args.url })
        } else {
          const op = need(args.history, 'url or history')
          if (op === 'back' && !wc.navigationHistory.canGoBack()) throw new BrowserToolError('browser_denied', 'no page to go back to')
          if (op === 'forward' && !wc.navigationHistory.canGoForward()) throw new BrowserToolError('browser_denied', 'no page to go forward to')
          await host.navigate(id, { history: op })
        }
        await settle(wc, 15_000)
        return text(tabSummary(host, id))
      })
    }
    case 'browser_snapshot': {
      const args = a as unknown as z.infer<typeof schemas.browser_snapshot>
      return host.runOnTab(id, 'snapshot', async () => {
        const snap = await snapshot(wc, args.maxChars ?? 40_000, args.scope)
        const head = `# ${snap.title || '(untitled)'}\nurl: ${snap.url}\ntabId: ${id}\n`
        const tail = snap.truncated ? '\n… (truncated: pass scope=<ref> to read one region)' : ''
        return text(`${head}\n${snap.text || '(empty page)'}${tail}`)
      })
    }
    case 'browser_screenshot':
      return host.runOnTab(id, 'screenshot', async () => {
        const shot = await host.screenshotPng(id)
        return {
          content: [
            { type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: JSON.stringify({ ...tabSummary(host, id), width: shot.width, height: shot.height }) },
          ],
        }
      })
    case 'browser_act': {
      const args = a as unknown as z.infer<typeof schemas.browser_act>
      return host.runOnTab(id, args.action, async () => {
        const detail = await act(wc, pointer, args, call.cwd)
        await settle(wc)
        return text({ ok: true, ...detail, tab: tabSummary(host, id) })
      })
    }
    case 'browser_wait': {
      const args = a as unknown as z.infer<typeof schemas.browser_wait>
      if (!args.text === !args.url) throw new BrowserToolError('browser_denied', 'pass exactly one of text or url')
      await waitFor(wc, args, args.timeoutMs ?? 10_000)
      return text({ ok: true, tab: tabSummary(host, id) })
    }
    case 'browser_logs': {
      const args = a as unknown as z.infer<typeof schemas.browser_logs>
      const entries = host.logs(id, args.max ?? 30)
      return text(entries.length ? entries.map((e) => `${e.kind === 'network' ? 'network' : e.level}: ${e.message}${e.source ? ` (${e.source})` : ''}`).join('\n') : 'no errors or warnings')
    }
    case 'browser_eval': {
      const args = a as unknown as z.infer<typeof schemas.browser_eval>
      return host.runOnTab(id, 'eval', async () => {
        // Isolated world: shares the DOM, not the page's JavaScript globals.
        const code = `(async () => {
          const fn = (${args.function});
          const store = window.__piDesktopRefs;
          const el = ${JSON.stringify(args.ref ?? null)} ? store && store.map.get(${JSON.stringify(args.ref ?? '')})?.deref() : undefined;
          if (${JSON.stringify(!!args.ref)} && !el) return { __error: 'browser_stale_ref' };
          const value = await fn(el);
          return { value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
        })()`
        const res = await inPage<{ value?: unknown; __error?: string }>(wc, code, 10_000)
        if (res?.__error) throw new BrowserToolError('browser_stale_ref', 'take a new snapshot')
        const out = JSON.stringify(res?.value ?? null)
        return text(out.length > 20_000 ? `${out.slice(0, 20_000)}… (truncated)` : out)
      })
    }
    default:
      throw new BrowserToolError('browser_denied', `unknown tool ${call.tool}`)
  }
}

async function act(
  wc: Electron.WebContents,
  pointer: import('./browser-agent').Pointer,
  args: z.infer<typeof schemas.browser_act>,
  cwd: string,
): Promise<Record<string, unknown>> {
  switch (args.action) {
    case 'click':
    case 'dblclick':
    case 'rightclick': {
      const r = await actionable(wc, need(args.ref, 'ref'))
      const p = centerOf(r)
      await pointer.click(p.x, p.y, { button: args.action === 'rightclick' ? 'right' : 'left', clickCount: args.action === 'dblclick' ? 2 : 1 })
      return {}
    }
    case 'hover': {
      const p = centerOf(await actionable(wc, need(args.ref, 'ref')))
      await pointer.moveTo(p.x, p.y)
      return {}
    }
    case 'fill': {
      const target = need(args.ref, 'ref')
      const p = centerOf(await actionable(wc, target))
      await pointer.click(p.x, p.y)
      await focusAndSelect(wc, target)
      const value = args.value ?? ''
      if (value) await typeText(wc, value)
      else await pressKey(wc, 'Backspace')
      return {}
    }
    case 'type': {
      if (args.ref) {
        const p = centerOf(await actionable(wc, args.ref))
        await pointer.click(p.x, p.y)
      }
      await typeText(wc, need(args.value, 'value'))
      return {}
    }
    case 'press': {
      if (args.ref) {
        const p = centerOf(await actionable(wc, args.ref))
        await pointer.click(p.x, p.y)
      }
      await pressKey(wc, need(args.key, 'key'))
      return {}
    }
    case 'select':
      return { selected: await selectOption(wc, need(args.ref, 'ref'), need(args.value, 'value')) }
    case 'scroll': {
      const deltaY = args.deltaY ?? 600
      if (args.ref) {
        const p = centerOf(await actionable(wc, args.ref))
        await pointer.moveTo(p.x, p.y)
        pointer.wheel(p.x, p.y, deltaY)
      } else {
        const [w, h] = await inPage<[number, number]>(wc, '[innerWidth, innerHeight]')
        pointer.wheel(Math.round(w / 2), Math.round(h / 2), deltaY)
      }
      return {}
    }
    case 'drag': {
      const from = centerOf(await actionable(wc, need(args.ref, 'ref')))
      const to = centerOf(await actionable(wc, need(args.targetRef, 'targetRef')))
      await pointer.drag(from, to)
      return {}
    }
    case 'upload':
      return { uploaded: await uploadFiles(wc, need(args.ref, 'ref'), need(args.files, 'files'), cwd) }
  }
}

/** Run one agent tool call; errors come back as tool errors the model can read and act on. */
export async function executeBrowserTool(host: BrowserHost, call: BrowserToolCall): Promise<ToolResult> {
  try {
    return await execute(host, call)
  } catch (error) {
    const message = error instanceof BrowserToolError ? error.message : `browser_error: ${(error as Error)?.message ?? String(error)}`
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}
