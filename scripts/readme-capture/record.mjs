// Frame-by-frame recordings: a live agent turn (real worker, scripted model) and the composer.
// Each frame's capture time goes into times.json so the GIF replays at real speed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clickText, launchApp } from './app.mjs'
import { MOCK_PORT, UI } from './config.mjs'
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
  const save = () => writeFileSync(join(outDir, 'times.json'), JSON.stringify(times))
  return { shot, hold, type, save, count: () => times.length }
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
