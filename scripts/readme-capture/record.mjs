// Frame-by-frame recordings: a live agent turn (real worker, scripted model) and the composer.
// Each frame's capture time goes into times.json so the GIF replays at real speed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clickText, launchApp } from './app.mjs'
import { MOCK_PORT, SPLITTER, UI } from './config.mjs'
import { text } from './demo-script.mjs'
import { startMockLlm } from './mock-llm.mjs'

function recorder(win, outDir) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const times = []
  const shot = async () => {
    const name = `f${String(times.length).padStart(4, '0')}.png`
    await win.screenshot({ path: join(outDir, name) })
    times.push([name, Date.now()])
  }
  const hold = async (ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      await shot()
      await win.waitForTimeout(80)
    }
  }
  const type = async (value, everyChar = true) => {
    for (const ch of value) {
      await win.keyboard.type(ch)
      if (everyChar || Math.random() < 0.6) await shot()
      else await win.waitForTimeout(35)
    }
  }
  /** Drag horizontally in a few recorded steps (used for the sidebar splitter). */
  const drag = async (fromX, y, toX, steps = 10) => {
    await win.mouse.move(fromX, y)
    await win.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await win.mouse.move(fromX + ((toX - fromX) * i) / steps, y)
      await shot()
    }
    await win.mouse.up()
  }
  const save = () => writeFileSync(join(outDir, 'times.json'), JSON.stringify(times))
  return { shot, hold, type, drag, save, count: () => times.length }
}

async function focusComposer(win) {
  await win.locator('[contenteditable="true"]').last().click()
  await win.waitForTimeout(300)
}

/** A new session runs the fix turn end to end; Review stays on the Git scope. */
export async function recordAgentTurn({ appDir, demo, lang, outDir }) {
  const mock = await startMockLlm({ port: MOCK_PORT, lang })
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await clickText(win, 'lumen')
    await win.waitForTimeout(2000)
    await win.locator(`button[aria-label="${UI[lang].newSession}"]`).first().click()
    await win.waitForTimeout(1500)
    await clickText(win, 'Git', { exact: false, side: 'right' }).catch(() => {})
    await win.waitForTimeout(1200)
    await focusComposer(win)
    await rec.shot()
    await rec.type(text(lang).fixPrompt, false)
    await rec.hold(300)
    await win.keyboard.press('Enter')
    const started = Date.now()
    let idleSince = 0
    while (Date.now() - started < 60_000) {
      await rec.shot()
      await win.waitForTimeout(120)
      const running = await win.evaluate(() => !!document.querySelector('[aria-label*="停止"],[aria-label*="Stop"],button[title*="停止"],button[title*="Stop"]'))
      if (running) idleSince = 0
      else if (!idleSince) idleSince = Date.now()
      else if (Date.now() - idleSince > 2500) break
    }
    await rec.hold(600)
    // Working-tree edits do not touch .git, so the Git scope needs the panel's refresh button.
    const stale = await win.evaluate(() => /HEAD/.test(document.body.innerText))
    if (stale) {
      await win.evaluate(() => {
        const refresh = [...document.querySelectorAll('button')].find((b) => {
          const r = b.getBoundingClientRect()
          return r.x > innerWidth - 60 && r.y > 80 && r.y < 120
        })
        refresh?.click()
      })
    }
    await rec.hold(1500)
    rec.save()
    console.log(`  agent turn: ${rec.count()} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } finally {
    await app.close()
    await mock.close()
  }
}

/** Typing `@li` suggests project files; Enter inserts the reference as a chip. */
export async function recordComposer({ appDir, demo, lang, outDir }) {
  const t = text(lang)
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await clickText(win, 'lumen')
    await win.waitForTimeout(2000)
    await clickText(win, t.planTitle)
    await win.waitForTimeout(2500)
    await focusComposer(win)
    await rec.hold(600)
    await rec.type(t.mentionBefore)
    await rec.type('@li')
    await rec.hold(1100)
    await win.keyboard.press('Enter')
    await rec.hold(500)
    await rec.type(t.mentionAfter)
    await rec.hold(2200)
    rec.save()
    console.log(`  composer: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

async function openFixSession(win, lang) {
  await clickText(win, 'lumen')
  await win.waitForTimeout(2000)
  await clickText(win, text(lang).fixTitle, { exact: false })
  await win.waitForTimeout(2500)
}

/** Widen the right sidebar, open the Git diff side by side and stage one hunk. */
export async function recordReviewStage({ appDir, demo, lang, outDir }) {
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await openFixSession(win, lang)
    await clickText(win, 'Review', { side: 'right' })
    await rec.hold(700)
    await rec.drag(SPLITTER.x, SPLITTER.y, SPLITTER.wideX)
    await rec.hold(500)
    await clickText(win, 'Git', { side: 'right' })
    await rec.hold(700)
    await clickText(win, 'links.mjs', { side: 'right' })
    await rec.hold(1300)
    await win.locator('button[aria-label="Switch to side-by-side"], button[aria-label="切换到并排视图"]').first().click()
    await rec.hold(1800)
    await win.locator('button[aria-label="Stage this hunk"], button[aria-label="暂存此片段"]').first().hover()
    await rec.hold(500)
    await win.locator('button[aria-label="Stage this hunk"], button[aria-label="暂存此片段"]').first().click()
    await rec.hold(2600)
    rec.save()
    console.log(`  review: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

/** Preview a file, open another in a new tab, quote a line into the composer, expand the preview. */
export async function recordFiles({ appDir, demo, lang, outDir }) {
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await openFixSession(win, lang)
    await clickText(win, UI[lang].files, { side: 'right' })
    await rec.hold(500)
    await rec.drag(SPLITTER.x, SPLITTER.y, SPLITTER.wideX)
    await rec.hold(500)
    await clickText(win, 'src', { side: 'right' })
    await rec.hold(600)
    await clickText(win, 'links.mjs', { side: 'right' })
    await rec.hold(1200)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await win.locator('[title="src/links.test.mjs"]').last().click({ modifiers: [modifier] })
    await rec.hold(1400)
    const quote = win.locator('button[title*="links.test.mjs:9 "]').first()
    await quote.hover()
    await rec.hold(400)
    await quote.click()
    await rec.hold(1300)
    await win.locator('button[aria-label="Expand preview into chat column"], button[aria-label="展开预览到聊天区"]').first().click()
    await rec.hold(2400)
    rec.save()
    console.log(`  files: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

/** Two new sessions run at once; switching between them never interrupts either turn. */
export async function recordParallel({ appDir, demo, lang, outDir, stillPath }) {
  const t = text(lang)
  const mock = await startMockLlm({ port: MOCK_PORT, lang, pace: 1.6 })
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  const newSession = () => win.locator(`button[aria-label="${UI[lang].newSession}"]`).first().click()
  const send = async (prompt) => {
    await focusComposer(win)
    await win.keyboard.insertText(prompt)
    await rec.hold(350)
    await win.keyboard.press('Enter')
  }
  try {
    await clickText(win, 'lumen')
    await win.waitForTimeout(2000)
    await newSession()
    await win.waitForTimeout(1200)
    await rec.hold(400)
    await send(t.fixPrompt)
    await rec.hold(2200)
    await newSession()
    await rec.hold(800)
    await send(t.remotePrompt)
    await rec.hold(2800)
    if (stillPath) await win.screenshot({ path: stillPath })
    await rec.hold(200)
    await clickText(win, t.fixPrompt.slice(0, 12), { exact: false })
    await rec.hold(3500)
    await clickText(win, t.remotePrompt.slice(0, 12), { exact: false })
    const started = Date.now()
    let idleSince = 0
    while (Date.now() - started < 60_000) {
      await rec.shot()
      await win.waitForTimeout(120)
      const running = await win.evaluate(() => !!document.querySelector('[aria-label*="停止"],[aria-label*="Stop"],button[title*="停止"],button[title*="Stop"]'))
      if (running) idleSince = 0
      else if (!idleSince) idleSince = Date.now()
      else if (Date.now() - idleSince > 1500) break
    }
    await clickText(win, t.fixPrompt.slice(0, 12), { exact: false })
    await rec.hold(2600)
    rec.save()
    console.log(`  parallel: ${rec.count()} frames`)
  } finally {
    await app.close()
    await mock.close()
  }
}
