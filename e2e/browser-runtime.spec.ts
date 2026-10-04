import { test, expect } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import { launchAgentApp, listen, refIn, startScriptedModel, type Script, type Seen } from './helpers/scripted-agent'

/**
 * Every browser_* tool against a real page in the built-in browser (engine E), driven by a
 * scripted model through the real worker → Main path.
 */
function startSite(events: string[]) {
  return http.createServer(async (req, res) => {
    if (req.url === '/log') {
      let body = ''
      for await (const chunk of req) body += chunk
      events.push(...(JSON.parse(body) as string[]))
      res.end('ok')
      return
    }
    if (req.url === '/slow-search') {
      setTimeout(() => res.end('3'), 600)
      return
    }
    if (req.url === '/missing.json') {
      res.statusCode = 404
      res.end('nope')
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/next') {
      res.end('<!doctype html><title>Next</title><body><h1>Next page</h1><a href="/app">Back to lab</a></body>')
      return
    }
    res.end(`<!doctype html><title>Lab</title>
      <style>
        body { font: 15px sans-serif; margin: 20px }
        #chip, #bin { display: inline-block; width: 90px; height: 50px; border: 1px solid #888; margin: 8px; user-select: none }
        #overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: none; align-items: center; justify-content: center }
        #overlay.open { display: flex }
        #notes { border: 1px solid #888; min-height: 40px; padding: 4px }
      </style>
      <body><main>
        <h1>Lab</h1>
        <label for="name">Name</label> <input id="name" value="old">
        <label><input type="checkbox" id="agree"> Agree</label>
        <label for="plan">Plan</label> <select id="plan"><option value="f">Free</option><option value="p">Pro</option></select>
        <label for="volume">Volume</label> <input id="volume" type="range" min="0" max="10" value="2">
        <div id="notes" contenteditable="true" role="textbox" aria-label="Notes"><p>draft</p></div>
        <label for="avatar">Avatar</label> <input id="avatar" type="file">
        <div><span id="chip">Chip</span><span id="bin">Bin</span></div>
        <button id="submit">Submit</button> <button id="open">Open modal</button> <button id="search">Search</button>
        <p id="results"></p>
        <p id="out"></p>
        <a href="/next">Next page</a>
        <div style="height:2600px"></div>
        <a href="/next" id="footer">Footer link</a>
      </main>
      <div id="overlay" role="dialog" aria-label="Promo"><button id="close">Close</button></div>
      <script>
        const log = [];
        for (const t of ['mousedown', 'click', 'input', 'keydown'])
          document.addEventListener(t, (e) => log.push(t + ':' + (e.target.id || e.target.tagName) + ':' + e.isTrusted), true);
        const $ = (id) => document.getElementById(id);
        let dragging = false;
        $('chip').addEventListener('mousedown', () => { dragging = true });
        document.addEventListener('mouseup', (e) => {
          if (dragging && document.elementFromPoint(e.clientX, e.clientY) === $('bin')) $('bin').textContent = 'Bin: dropped';
          dragging = false;
        });
        $('open').addEventListener('click', () => $('overlay').classList.add('open'));
        $('close').addEventListener('click', () => $('overlay').classList.remove('open'));
        // A result that arrives after a slow fetch (600 ms), like a real single-page app.
        $('search').addEventListener('click', () => fetch('/slow-search').then((r) => r.text()).then((n) => { $('results').textContent = 'Results loaded: ' + n + ' items' }));
        $('submit').addEventListener('click', () => {
          $('out').textContent = 'Saved: ' + [$('name').value, $('agree').checked, $('plan').value, $('volume').value, $('notes').innerText.trim(), $('avatar').files[0]?.name, $('bin').textContent].join('|');
          fetch('/log', { method: 'POST', body: JSON.stringify(log) });
        });
        console.error('lab boom');
        fetch('/missing.json');
      </script></body>`)
  })
}

const script =
  (base: string): Script =>
  (firstUser, r) => {
    if (!firstUser.includes('LAB-TASK')) return { text: 'plain done' }
    const steps: (() => { name: string; args: unknown })[] = [
      () => ({ name: 'browser_navigate', args: { url: `${base}/app` } }), // 0
      () => ({ name: 'browser_snapshot', args: {} }), // 1
      () => ({ name: 'browser_find', args: { text: 'Footer' } }), // 2
      () => ({
        name: 'browser_fill_form',
        args: {
          fields: [
            { target: "getByLabel('Name')", name: 'Name', type: 'textbox', value: 'Maya' },
            { target: refIn(r, /checkbox "Agree"/), name: 'Agree', type: 'checkbox', value: 'true' },
            { target: "getByRole('combobox', { name: 'Plan' })", name: 'Plan', type: 'combobox', value: 'Pro' },
            { target: '#volume', name: 'Volume', type: 'slider', value: '7' },
          ],
        },
      }), // 3
      () => ({ name: 'browser_type', args: { target: "getByRole('textbox', { name: 'Notes' })", text: 'Hello rich' } }), // 4
      () => ({ name: 'browser_click', args: { target: '#avatar' } }), // 5 refused: file chooser
      () => ({ name: 'browser_file_upload', args: { target: '#avatar', paths: ['README.md'] } }), // 6
      () => ({ name: 'browser_drag', args: { startTarget: '#chip', endTarget: '#bin' } }), // 7
      () => ({ name: 'browser_click', args: { target: "getByRole('button', { name: 'Submit' })" } }), // 8
      () => ({ name: 'browser_click', args: { target: "getByRole('button', { name: 'Open modal' })" } }), // 9
      () => ({ name: 'browser_snapshot', args: {} }), // 10
      () => ({ name: 'browser_click', args: { target: refIn(r, /button "Close"/) } }), // 11
      () => ({ name: 'browser_mouse_wheel', args: { deltaY: 1200 } }), // 12
      () => ({ name: 'browser_console_messages', args: {} }), // 13
      () => ({ name: 'browser_network_requests', args: {} }), // 14
      () => ({ name: 'browser_evaluate', args: { function: '(el) => el.textContent', target: '#out' } }), // 15
      () => ({ name: 'browser_take_screenshot', args: { target: '#bin' } }), // 16
      () => ({ name: 'browser_press_key', args: { key: 'Home' } }), // 17
      () => ({ name: 'browser_hover', args: { target: '#submit' } }), // 18
      () => ({ name: 'browser_click', args: { target: refIn(r, /link "Next page"/) } }), // 19
      () => ({ name: 'browser_navigate_back', args: {} }), // 20
      () => ({ name: 'browser_tabs', args: { action: 'new', url: `${base}/next` } }), // 21
      () => ({ name: 'browser_tabs', args: { action: 'select', index: 0 } }), // 22
      () => ({ name: 'browser_pdf_save', args: { filename: 'lab' } }), // 23
      () => ({ name: 'browser_wait_for', args: { text: 'Lab' } }), // 24
      () => ({ name: 'browser_handle_dialog', args: { accept: true } }), // 25 unsupported on engine E
      () => ({ name: 'browser_select_option', args: { target: '#plan', values: ['Free'] } }), // 26
      () => ({ name: 'browser_click', args: { target: 'e999999' } }), // 27 stale ref
      () => ({ name: 'browser_click', args: { target: "getByRole('button', { name: 'Search' })", element: 'Search button' } }), // 28 async result
    ]
    // Only the core browser tools are declared at first; load the rest the way a model would.
    if (r.length === 0) return { tool: { name: 'tool_search', args: { query: 'browser', limit: 30 } } }
    const step = steps[r.length - 1]
    return step ? { tool: step() } : { text: 'lab done' }
  }

test.describe('browser agent runtime', () => {
  test.setTimeout(240_000)

  test('every browser tool works on a real page', async () => {
    const events: string[] = []
    const seen: Seen[] = []
    const site = startSite(events)
    const base = `http://127.0.0.1:${await listen(site)}`
    const model = startScriptedModel(script(base), seen)
    const agent = await launchAgentApp(await listen(model))
    try {
      await agent.newSession()
      await agent.enableBrowserControl()
      await agent.send('LAB-TASK exercise the lab page')
      await expect(agent.win.getByText('lab done')).toBeVisible({ timeout: 200_000 })

      const [search, ...r] = seen.at(-1)!.toolTexts
      expect(r).toHaveLength(29)
      // At first only the core tools and tool_search are declared…
      const first = seen.find((s) => s.firstUser.includes('LAB-TASK'))!
      expect(first.tools.filter((t) => t.startsWith('browser_')).sort()).toEqual(['browser_click', 'browser_mouse_wheel', 'browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'browser_type'])
      expect(first.tools).toContain('tool_search')
      // …and tool_search loads the rest of the Playwright MCP set.
      expect(search).toMatch(/browser_tabs/)
      expect(seen.at(-1)!.tools.filter((t) => t.startsWith('browser_'))).toHaveLength(21)

      expect(r[0]).toMatch(/URL: .*\/app/)
      expect(r[0]).toMatch(/### Snapshot \(interactive elements\)[\s\S]*textbox "Name"/)
      expect(r[0]).toMatch(/below the visible area/) // footer link is far down
      expect(r[1]).toMatch(/```yaml[\s\S]*- heading "Lab" \[level=1\]/)
      expect(r[2]).toMatch(/link "Footer link"/)
      expect(r[3]).toMatch(/Filled 4 field\(s\)/)
      expect(r[3]).toMatch(/### Changes[\s\S]*checkbox "Agree" \[checked\]/)
      expect(r[4]).toMatch(/Typed 10 character/)
      expect(r[5]).toMatch(/browser_denied: .*browser_file_upload/)
      expect(r[6]).toMatch(/Set 1 file\(s\): README\.md/)
      expect(r[7]).toMatch(/Dragged/)
      expect(r[8]).toMatch(/Saved: Maya\|true\|p\|7\|Hello rich\|README\.md\|Bin: dropped/)
      expect(r[9]).toMatch(/### Changes[\s\S]*dialog "Promo"/)
      // Overlay covers the page: covered elements lose their refs, the dialog's button keeps one.
      expect(r[10]).toMatch(/covered by an overlay/)
      expect(r[10]).toMatch(/button "Close" \[ref=e\d+\]/)
      expect(r[10]).toMatch(/button "Submit"(?! \[ref)/)
      expect(r[11]).toMatch(/### Changes/)
      expect(r[12]).toMatch(/Scrolled down 1200px/)
      expect(r[13]).toMatch(/\[error\] lab boom/)
      expect(r[14]).toMatch(/404.*missing\.json|missing\.json.*404/)
      expect(r[15]).toMatch(/Saved: Maya/)
      expect(r[16]).toMatch(/Screenshot \d+×\d+ of #bin/)
      expect(r[17]).toMatch(/Pressed Home/)
      expect(r[18]).toMatch(/Hovered button "Submit"/)
      expect(r[19]).toMatch(/URL: .*\/next \(changed\)[\s\S]*### Snapshot \(new page/)
      expect(r[20]).toMatch(/URL: .*\/app \(changed\)/)
      expect(r[21]).toMatch(/- 0: \[Lab\][\s\S]*- 1: \(current\) \[Next\]/)
      expect(r[22]).toMatch(/- 0: \(current\) \[Lab\]/)
      const pdf = r[23].match(/Saved PDF \(\d+ KB\): (.+\.pdf)/)?.[1]
      expect(pdf).toBeTruthy()
      expect(fs.readFileSync(pdf!).subarray(0, 4).toString()).toBe('%PDF')
      expect(r[24]).toMatch(/Waited for "Lab"/)
      expect(r[25]).toMatch(/browser_unsupported/)
      expect(r[26]).toMatch(/Selected "f" in combobox "Plan"/)
      expect(r[27]).toMatch(/browser_stale_ref/)
      // The click waits for the DOM to go quiet, so the late result is in the reported changes.
      expect(r[28]).toMatch(/### Changes[\s\S]*Results loaded: 3 items/)
      // No unexpected errors anywhere else.
      const expectedErrors = new Set([5, 25, 27])
      expect(r.filter((t, i) => !expectedErrors.has(i) && /^browser_[a-z_]+: /m.test(t))).toEqual([])

      // Pointer and keyboard input was trusted; only programmatic value setters (select,
      // slider, file input) dispatch untrusted events, and those carry their element ids.
      await expect.poll(() => events.length, { timeout: 10_000 }).toBeGreaterThan(0)
      const untrusted = events.filter((e) => e.endsWith(':false') && !/:(plan|volume|avatar):/.test(e))
      expect(untrusted).toEqual([])
      expect(events).toContain('input:name:true')
      expect(events).toContain('input:notes:true')
    } finally {
      await agent.close()
      site.close()
      model.close()
    }
  })
})
