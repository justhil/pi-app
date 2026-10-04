import { test, expect } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, refIn, root, startScriptedModel, type Script, type Seen } from './helpers/scripted-agent'

const shotDir = path.join(root, 'test-results', 'browser-agent')

/** Test page: a form whose events report whether they were trusted input. */
function startSite(events: string[]) {
  return http.createServer(async (req, res) => {
    if (req.url === '/log') {
      let body = ''
      for await (const chunk of req) body += chunk
      events.push(...(JSON.parse(body) as string[]))
      res.end('ok')
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>Profile</title><body style="font:16px sans-serif;margin:24px">
      <main><h1>Profile</h1>
        <label for="name">Name</label> <input id="name">
        <button id="save" style="margin-left:8px">Save</button>
        <p id="out"></p>
      </main>
      <script>
        const log = [];
        for (const t of ['mousedown', 'click', 'input']) document.addEventListener(t, (e) => log.push(t + ':' + e.isTrusted), true);
        document.getElementById('save').addEventListener('click', () => {
          document.getElementById('out').textContent = 'Saved ' + document.getElementById('name').value;
          fetch('/log', { method: 'POST', body: JSON.stringify(log) });
        });
      </script></body>`)
  })
}

const script =
  (siteBase: string): Script =>
  (firstUser, results) => {
    if (!firstUser.includes('BROWSER-TASK')) return { text: 'plain done' }
    const steps = [
      { tool: { name: 'browser_navigate', args: { url: `${siteBase}/form` } } },
      { tool: { name: 'browser_snapshot', args: {} } },
      { tool: { name: 'browser_type', args: { target: refIn(results, /textbox "Name"/), text: 'Maya', element: 'Name field' } } },
      { tool: { name: 'browser_click', args: { target: refIn(results, /button "Save"/), element: 'Save button' } } },
      { tool: { name: 'tool_search', args: { query: 'browser wait screenshot' } } },
      { tool: { name: 'browser_wait_for', args: { text: 'Saved Maya' } } },
      { tool: { name: 'browser_take_screenshot', args: {} } },
      { text: 'browser done' },
    ]
    return steps[Math.min(results.length, steps.length - 1)]
  }

test.describe('browser control capability', () => {
  test.setTimeout(180_000)

  test('drives the browser through real tools only while switched on', async () => {
    const events: string[] = []
    const seen: Seen[] = []
    const site = startSite(events)
    const siteBase = `http://127.0.0.1:${await listen(site)}`
    const model = startScriptedModel(script(siteBase), seen)
    const agent = await launchAgentApp(await listen(model))
    fs.mkdirSync(shotDir, { recursive: true })
    const { win } = agent
    try {
      // Session 1: switch browser control on, then ask.
      await agent.newSession()
      await agent.enableBrowserControl()
      await expect(win.locator('.composer-capability-chip')).toHaveCount(1)
      await agent.send('BROWSER-TASK fill the profile form')
      await win.waitForTimeout(1500)

      await expect.poll(() => seen.filter((s) => s.firstUser.includes('BROWSER-TASK')).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(7)
      await expect(win.getByText('browser done')).toBeVisible({ timeout: 30_000 })
      await win.screenshot({ path: path.join(shotDir, 'timeline.png') })

      const browserTurns = seen.filter((s) => s.firstUser.includes('BROWSER-TASK'))
      expect(browserTurns[0].tools).toEqual(expect.arrayContaining(['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'tool_search']))
      expect(browserTurns[0].tools).not.toContain('browser_take_screenshot')
      expect(browserTurns.at(-1)!.tools).toEqual(expect.arrayContaining(['browser_wait_for', 'browser_take_screenshot']))
      expect(browserTurns[0].system).toContain('# Built-in browser')
      // Every tool call succeeded: no error codes came back, and the snapshot carried the refs.
      const results = browserTurns.at(-1)!.toolTexts
      expect(results.filter((r) => /^browser_[a-z_]+: /m.test(r))).toEqual([])
      expect(results[1]).toMatch(/textbox "Name" \[ref=e\d+\]/)
      expect(results[1]).toMatch(/button "Save" \[ref=e\d+\]/)
      // The click reports what changed instead of a whole new snapshot.
      expect(results[3]).toMatch(/### Changes[\s\S]*Saved Maya/)
      // The page received real (trusted) input from the agent.
      await expect.poll(() => events.length, { timeout: 10_000 }).toBeGreaterThan(0)
      expect(events).toContain('click:true')
      expect(events).toContain('input:true')
      expect(events.filter((e) => e.endsWith(':false'))).toEqual([])

      // Session 2: a new session starts with every capability off.
      await agent.newSession()
      await expect(win.locator('.composer-capability-chip')).toHaveCount(0)
      await agent.send('PLAIN-TASK hello')
      await expect.poll(() => seen.some((s) => s.firstUser.includes('PLAIN-TASK')), { timeout: 60_000 }).toBe(true)
      const plain = seen.find((s) => s.firstUser.includes('PLAIN-TASK'))!
      expect(plain.tools.filter((t) => t.startsWith('browser_'))).toEqual([])
      expect(plain.system).not.toContain('Built-in browser')
      expect(plain.system).not.toContain('browser_')
    } finally {
      await agent.close()
      site.close()
      model.close()
    }
  })
})
