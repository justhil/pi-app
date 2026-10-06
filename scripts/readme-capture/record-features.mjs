// Recordings and stills of the 0.8 features: built-in terminal, branch switcher, usage page, themes + background.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clickText, launchApp } from './app.mjs'
import { UI } from './config.mjs'
import { text } from './demo-script.mjs'
import { recorder } from './record.mjs'

const COPY = {
  zh: { strength: '图片强度', uiOpacity: '界面不透明度', split: '左右分屏', closePane: '关闭此栏', usage: '用量', days90: '90 天', back: '返回', save: '保存', dark: '深色', light: '浅色', lightTheme: '浅色主题', darkTheme: '深色主题', choose: '选择图片…' },
  en: { strength: 'Image strength', uiOpacity: 'Interface opacity', split: 'Split right', closePane: 'Close pane', usage: 'Usage', days90: '90 days', back: 'Back', save: 'Save', dark: 'Dark', light: 'Light', lightTheme: 'Light theme', darkTheme: 'Dark theme', choose: 'Choose image…' },
}

async function openPlanSession(win, lang, title = text(lang).planTitle) {
  await clickText(win, 'lumen')
  await win.waitForTimeout(1800)
  await clickText(win, title, { exact: false })
  await win.waitForTimeout(2200)
}

/** Ctrl+` opens pi's shell in the project; a split runs a second shell; one pane is closed on its own. */
export async function recordTerminal({ appDir, demo, lang, outDir }) {
  // A short prompt: the demo HOME has no shell rc files.
  process.env.PS1 = 'lumen $ '
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  const c = COPY[lang]
  try {
    await openPlanSession(win, lang)
    await rec.hold(500)
    await win.keyboard.press('Control+Backquote')
    await win.locator('.terminal-drawer .xterm').first().waitFor({ timeout: 15_000 })
    await rec.hold(700)
    await win.locator('.terminal-drawer .xterm').first().click()
    await rec.type('git log --oneline -3\n', false)
    await rec.hold(900)
    await rec.type('node --test 2>&1 | grep -E "^. (tests|pass|fail) "\n', false)
    await rec.hold(2200)
    await win.getByRole('button', { name: c.split }).click()
    await rec.hold(500)
    await win.getByRole('menuitem').first().click()
    await win.locator('.terminal-drawer .xterm').nth(1).waitFor({ timeout: 15_000 })
    await rec.hold(700)
    await rec.type('git status --short\n', false)
    await rec.hold(1200)
    const close = win.locator('.terminal-drawer').getByRole('button', { name: c.closePane }).nth(1)
    await close.hover()
    await rec.hold(500)
    await close.click()
    await rec.hold(1500)
    rec.save()
    console.log(`  terminal: ${rec.count()} frames`)
  } finally {
    delete process.env.PS1
    // Running shells make the window's close guard ask first; end them so the app can quit.
    await win.evaluate(() => document.querySelectorAll('.terminal-drawer [aria-label="Close terminal"], .terminal-drawer [aria-label="关闭终端"]').forEach((b) => b.click())).catch(() => {})
    await win.waitForTimeout(500)
    await app.close()
  }
}

/** The status bar shows the branch; the picker finds and switches to another. */
export async function recordBranches({ appDir, demo, lang, outDir }) {
  const git = (...args) => execFileSync('git', args, { cwd: demo.project, stdio: 'pipe' })
  for (const b of ['feat/remote-checks', 'fix/unicode-urls', 'docs/cli-usage']) git('branch', b)
  const { app, win } = await launchApp({ appDir, demo, lang })
  const rec = recorder(win, outDir)
  try {
    await openPlanSession(win, lang)
    const trigger = win.locator('.branch-status-trigger')
    await trigger.waitFor({ timeout: 15_000 })
    await rec.hold(700)
    await trigger.hover()
    await rec.hold(300)
    await trigger.click()
    await rec.hold(900)
    await rec.type('remote')
    await rec.hold(700)
    await win.keyboard.press('Enter')
    await rec.hold(1800)
    rec.save()
    console.log(`  branches: ${rec.count()} frames`)
  } finally {
    await app.close()
  }
}

/** ~10 weeks of replies across two models, so the day chart and heatmaps have something to show. */
function seedUsage(demo) {
  const dir = join(demo.agentDir, 'sessions', '--usage-history--')
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const DAY = 86_400_000
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const rows = [JSON.stringify({ type: 'session', version: 3, id: 'usage-history', timestamp: new Date(now - 80 * DAY).toISOString(), cwd: demo.project })]
  for (let d = 72; d >= 0; d--) {
    const weekday = new Date(now - d * DAY).getDay()
    const calls = weekday === 0 || weekday === 6 ? Math.floor(rand() * 4) : 4 + Math.floor(rand() * 14)
    for (let i = 0; i < calls; i++) {
      const ts = now - d * DAY - Math.floor((9 + rand() * 10) * 3_600_000) + (d === 0 ? 20 * 3_600_000 : 0)
      if (ts > now) continue
      const big = rand() < 0.35
      const input = Math.floor(800 + rand() * 6000)
      const output = Math.floor(300 + rand() * 2500)
      const cacheRead = Math.floor(rand() * 60_000)
      const cost = big ? (input * 15 + output * 75 + cacheRead * 1.5) / 1e6 : (input * 3 + output * 15 + cacheRead * 0.3) / 1e6
      rows.push(JSON.stringify({ type: 'message', id: `u${d}-${i}`, parentId: null, timestamp: new Date(ts).toISOString(), message: { role: 'assistant', provider: 'demo', model: big ? 'opus-5' : 'sonnet-5', timestamp: ts, content: [], usage: { input, output, cacheRead, cacheWrite: Math.floor(rand() * 4000), totalTokens: 0, cost: { total: cost } } } }))
    }
  }
  writeFileSync(join(dir, '2026-07-28_usage-history.jsonl'), rows.join('\n') + '\n')
}

/** Settings → Usage on 90 days, with a bar hovered. */
export async function captureUsage({ appDir, demo, lang, out }) {
  seedUsage(demo)
  const { app, win } = await launchApp({ appDir, demo, lang })
  const c = COPY[lang]
  try {
    await clickText(win, UI[lang].settings)
    await win.waitForTimeout(1200)
    await clickText(win, c.usage)
    await win.waitForTimeout(1500)
    await win.getByRole('radio', { name: c.days90 }).click()
    await win.waitForTimeout(1500)
    // Range tabs at the top, the activity heatmap at the bottom.
    await win.mouse.move(800, 500)
    await win.mouse.wheel(0, 130)
    await win.waitForTimeout(800)
    // Day columns of the stacked chart; hover the lowest layer of one from last week.
    const bars = win.locator('.flex.h-40.items-end > div')
    const n = await bars.count()
    if (n) {
      const box = await bars.nth(Math.max(0, n - 9)).boundingBox()
      if (box) await win.mouse.move(box.x + box.width / 2, box.y + box.height - 6)
    }
    await win.waitForTimeout(600)
    await win.screenshot({ path: out })
  } finally {
    await app.close()
  }
}

/** Claude preset (light, then dark) and a background image behind the window. */
export async function captureThemes({ appDir, demo, lang, rawDir, image }) {
  const c = COPY[lang]
  const { app, win } = await launchApp({ appDir, demo, lang })
  try {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, image)
    await openPlanSession(win, lang, text(lang).fixTitle)
    await clickText(win, UI[lang].settings)
    await win.waitForTimeout(1000)
    await clickText(win, UI[lang].appearance)
    await win.waitForTimeout(1200)
    for (const section of [c.lightTheme, c.darkTheme]) {
      await win.getByRole('heading', { name: section }).locator('xpath=ancestor::section[1]').getByRole('radio', { name: 'Claude' }).click()
      await win.waitForTimeout(300)
    }
    await win.waitForTimeout(800)
    await win.screenshot({ path: join(rawDir, `${lang}-theme-settings.png`) })
    await win.getByRole('button', { name: c.save, exact: true }).click()
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: c.back, exact: true }).click()
    await win.waitForTimeout(1500)
    await win.screenshot({ path: join(rawDir, `${lang}-theme-claude-light.png`) })

    await clickText(win, UI[lang].settings)
    await win.waitForTimeout(800)
    await clickText(win, UI[lang].appearance)
    await win.waitForTimeout(1000)
    await win.getByRole('button', { name: c.dark, exact: true }).click()
    await win.getByRole('button', { name: c.choose }).click()
    await win.waitForTimeout(1200)
    await win.getByRole('slider', { name: c.strength }).fill('1')
    await win.getByRole('slider', { name: c.uiOpacity }).fill('0.7')
    await win.waitForTimeout(400)
    await win.getByRole('button', { name: c.save, exact: true }).click()
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: c.back, exact: true }).click()
    await win.waitForTimeout(2000)
    await win.screenshot({ path: join(rawDir, `${lang}-theme-claude-dark-bg.png`) })
  } finally {
    await app.close()
  }
}
