#!/usr/bin/env node
/**
 * Composer undo/redo regression harness (real Chromium).
 *
 * Why this exists: pi-app's composer is a contenteditable. Chromium's native
 * undo/redo only tracks edits the browser performs itself. If the app
 * intercepts a paste and inserts text programmatically (manual DOM mutation or
 * JS `execCommand('insertText')`), the undo stack is poisoned — the next
 * Ctrl+Z wipes the WHOLE editor content, including text typed before the
 * paste. See doc/CONTEXT.md「composer 撤销」decision record.
 *
 * This harness loads the real RichInput and composer DOM helpers, with these paste policies:
 *   - `--policy=native` (default, the fixed app behavior): text-only pastes go
 *     through the browser untouched (undoable); file/image pastes are
 *     intercepted and inserted via `execCommand('insertHTML')` (undoable chips).
 *   - `--policy=manual` (the old, broken behavior): every paste is
 *     preventDefault'ed and inserted with manual DOM mutation.
 * It then asserts the undo/redo guarantees. It is not wired into CI because it
 * needs a Playwright Chromium download; run it before/after composer input
 * changes:
 *
 *   node scripts/regression/composer-undo.mjs          # fixed policy
 *   node scripts/regression/composer-undo.mjs --policy=manual   # old policy (must FAIL)
 */
import { chromium } from 'playwright'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const editorBundle = await build({
  stdin: {
    contents: `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { flushSync } from 'react-dom'
      import { RichInput } from './src/renderer/src/features/composer/rich-input'
      import { insertTextAtCursor } from './src/renderer/src/features/composer/composer-editor-caret'
      import { insertAttachmentAtCursor, renderRichTextFromPlain, renderRichFromSegments, serializeRichInput, placeCaretAtEnd } from './src/renderer/src/features/composer/attachments'
      Object.assign(window, { insertTextAtCursor, insertAttachmentAtCursor, renderRichTextFromPlain, renderRichFromSegments, serializeRichInput, placeCaretAtEnd })
      flushSync(() => createRoot(document.getElementById('root')).render(createElement(RichInput, {
        ref: el => { if (el) el.id = 'input' },
        placeholder: 'Message or / command',
        onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault() },
      })))
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: { '@renderer': `${root}src/renderer/src`, '@shared': `${root}packages/shared` },
  define: { 'process.env.NODE_ENV': '"development"' },
})

const policy = process.argv.includes('--policy=manual') ? 'manual' : 'native'

const INSERT_TEXT = `
function insertChipAtCursor(el) {
  insertAttachmentAtCursor(el, { path: '/x', name: '[chip]', kind: 'file' })
}
function mirrorPolicy() {
  document.addEventListener('paste', (e) => {
    const cd = e.clipboardData
    if (!cd) return
    const plain = cd.getData('text/plain') || ''
    const meaningful = plain.replace(/[\\u200B\\u00a0\\s]/g, '').length > 0
    const hasFiles = Array.from(cd.items || []).some((it) => it.kind === 'file')
    if (POLICY === 'manual') {
      if (meaningful) {
        e.preventDefault()
        insertTextAtCursor(document.getElementById('input'), plain)
      }
      return
    }
    // native (fixed) policy: pure text pastes are NOT intercepted.
    if (!hasFiles && meaningful) return
    if (hasFiles) {
      e.preventDefault()
      insertChipAtCursor(document.getElementById('input'))
    }
  })
}
`

const PAGE = `<!doctype html>
<html><head><style>
  #input { position: relative; white-space: pre-wrap; word-break: break-word; min-height: 2.5rem; max-height: 112px; overflow-y: auto; font-size: 14px; line-height: 1.55; outline: none; }
  #input.is-empty::before { content: attr(data-placeholder); position: absolute; top: 0; left: 0; pointer-events: none; }
</style></head>
<body>
  <div id="root"></div>
  <script>${editorBundle.outputFiles[0].text}</script>
  <script>
    const POLICY = ${JSON.stringify(policy)}
    ${INSERT_TEXT}
    mirrorPolicy()
  </script>
</body></html>`

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(PAGE)
})
server.listen(8415)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`)
}

async function text(page) {
  return page.evaluate(() => document.getElementById('input').innerText)
}
async function ctrlZ(page, n = 1) { for (let i = 0; i < n; i++) { await page.keyboard.press('Control+z'); await sleep(40) } }
async function ctrlY(page, n = 1) { for (let i = 0; i < n; i++) { await page.keyboard.press('Control+y'); await sleep(40) } }
async function typeSlow(page, t) { for (const ch of t) { await page.keyboard.type(ch); await sleep(120) } }
async function pasteText(page, txt) {
  // 真实剪贴板 + 键盘触发：原生插入只对 trusted paste 生效（合成 ClipboardEvent 会被忽略）。
  await page.evaluate((t) => navigator.clipboard.writeText(t), txt)
  await page.keyboard.press('Control+v')
  await sleep(80)
}

async function scenario(name, fn) {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:8415/')
  await page.evaluate(() => document.getElementById('input').focus())
  console.log(`\n--- ${name} [policy=${policy}] ---`)
  await fn(page)
  await ctx.close()
  await browser.close()
}

console.log(`\n== composer undo regression (policy=${policy}) ==`)
await scenario('undo after paste must not wipe text typed before it', async (page) => {
  await typeSlow(page, 'abc')
  await sleep(300)
  await pasteText(page, 'hello world')
  check('paste result', await text(page), 'abchello world')
  await ctrlZ(page)
  // 核心回归：撤销只删粘贴的部分，不得清空整个输入（旧策略会整段清空）。
  check('after Ctrl+Z (typed text must survive)', await text(page), 'abc')
  await ctrlZ(page)
  check('after Ctrl+Z x2 (typing undone)', await text(page), '')
  await ctrlY(page)
  check('after Ctrl+Y (redo restores typing)', await text(page), 'abc')
})

await scenario('paste into empty editor must be undoable', async (page) => {
  await pasteText(page, 'hello world')
  check('paste result', await text(page), 'hello world')
  await ctrlZ(page)
  check('after Ctrl+Z (paste removed)', await text(page), '')
  await ctrlY(page)
  check('after Ctrl+Y (paste restored)', await text(page), 'hello world')
})

await scenario('multi-line paste into text keeps undo granularity', async (page) => {
  await typeSlow(page, 'prefix ')
  await sleep(300)
  await pasteText(page, 'line1\nline2\nline3')
  check('paste result', await text(page), 'prefix line1\nline2\nline3')
  await ctrlZ(page)
  check('after Ctrl+Z (only paste undone)', await text(page), 'prefix ')
  await ctrlZ(page)
  check('after Ctrl+Z x2 (typing undone)', await text(page), '')
})

await scenario('chip insert must be undoable without wiping text', async (page) => {
  await typeSlow(page, 'before ')
  await sleep(300)
  await page.evaluate(() => {
    const el = document.getElementById('input')
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el); range.collapse(false)
    sel.removeAllRanges(); sel.addRange(range)
    insertChipAtCursor(el)
  })
  check('chip present', await page.evaluate(() => !!document.querySelector('.rich-attachment-chip')), true)
  await ctrlZ(page)
  check('after Ctrl+Z (chip removed, text survives)', await text(page), 'before ')
  await ctrlZ(page)
  check('after Ctrl+Z x2 (typing undone)', await text(page), '')
})

await scenario('native Shift+Enter newline stays undoable', async (page) => {
  await typeSlow(page, 'ab')
  await sleep(300)
  await page.keyboard.press('Shift+Enter')
  await sleep(200)
  await typeSlow(page, 'cd')
  check('content', await text(page), 'ab\ncd')
  // Chromium 把整段输入（含 Shift+Enter）合并为一个原生撤销记录；保证可重做即可。
  await ctrlZ(page)
  check('after Ctrl+Z (session undone)', await text(page), '')
  await ctrlY(page)
  check('after Ctrl+Y (session restored)', await text(page), 'ab\ncd')
})

async function caretAtStart(page) {
  return page.evaluate(() => {
    const el = document.getElementById('input')
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return false
    const r = sel.getRangeAt(0)
    const first = el.firstChild
    if (!first) return true
    if (first.nodeType !== Node.TEXT_NODE) return false
    return r.startContainer === first && r.startOffset === 0
  })
}

await scenario('arrow keys must move across every line (paste with newlines)', async (page) => {
  await typeSlow(page, 'abc')
  await sleep(300)
  await pasteText(page, 'line1\nline2\nline3')
  check('paste result', await text(page), 'abcline1\nline2\nline3')
  // 从末尾一路 ← 到底，确认原生换行文本不会让光标在行首卡住。
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowLeft')
    await sleep(40)
  }
  check('caret reaches the very start', await caretAtStart(page), true)
})

await scenario('arrow keys must move across every line (history-restore DOM)', async (page) => {
  await page.evaluate(() => {
    const el = document.getElementById('input')
    renderRichTextFromPlain(el, 'l1\nl2\nl3\nl4')
    placeCaretAtEnd(el)
  })
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowLeft')
    await sleep(40)
  }
  check('caret reaches the very start', await caretAtStart(page), true)
})

await scenario('deleting all text must not create a phantom first line', async (page) => {
  await typeSlow(page, 'a')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => document.getElementById('input').classList.contains('is-empty'))
  check('empty editor stays one line', await page.$eval('#input', (el) => el.innerHTML), '<br>')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await page.keyboard.type('next')
  check('next text starts on the first line', await text(page), 'next')
})

await scenario('Backspace removes restored leading and trailing blank lines', async (page) => {
  for (const restore of ['renderRichTextFromPlain', 'renderRichFromSegments']) {
    await page.evaluate((name) => {
      const el = document.getElementById('input')
      if (name === 'renderRichTextFromPlain') renderRichTextFromPlain(el, '\n')
      else renderRichFromSegments(el, [{ type: 'text', text: '\n' }])
      placeCaretAtEnd(el)
    }, restore)
    await page.waitForFunction(() => !document.getElementById('input').classList.contains('is-empty'))
    check(`${restore}: blank line is preserved`, await page.$eval('#input', (el) => serializeRichInput(el).displayText), '\n')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('first')
    check(`${restore}: one Backspace removes the blank line`, await text(page), 'first')
  }
  await page.evaluate(() => {
    const el = document.getElementById('input')
    renderRichTextFromPlain(el, 'before\n')
    placeCaretAtEnd(el)
  })
  await page.keyboard.type('after')
  check('typing after a restored trailing newline stays on the next line', await text(page), 'before\nafter')
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  check('Backspace merges the lines', await text(page), 'beforeafter')
})

server.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
