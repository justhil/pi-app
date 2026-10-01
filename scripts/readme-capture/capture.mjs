// Static screenshots of one seeded session: hero (Review → Git diff), timeline, panels, settings.
import { join } from 'node:path'
import { clickText, launchApp } from './app.mjs'
import { SPLITTER, UI } from './config.mjs'
import { text } from './demo-script.mjs'

/** Screenshots land in <rawDir>/<lang>-<theme>-<name>.png. Dark theme only needs the hero. */
export async function captureScreens({ appDir, demo, lang, theme, rawDir }) {
  const ui = UI[lang]
  const { app, win } = await launchApp({ appDir, demo, lang, theme })
  const wait = (ms) => win.waitForTimeout(ms)
  const shot = async (name) => {
    await win.screenshot({ path: join(rawDir, `${lang}-${theme}-${name}.png`) })
    console.log(`  ${lang}-${theme}-${name}.png`)
  }
  const step = async (label, action) => {
    try {
      await action()
    } catch (error) {
      console.warn(`  step "${label}" failed: ${String(error).split('\n')[0]}`)
    }
  }
  try {
    await step('project', () => clickText(win, 'lumen'))
    await wait(2000)
    await step('session', () => clickText(win, text(lang).fixTitle, { exact: false }))
    await wait(3000)
    await step('review', () => clickText(win, 'Review', { side: 'right' }))
    await wait(800)
    await step('git', () => clickText(win, 'Git', { side: 'right' }))
    await wait(1500)
    await step('diff', () => clickText(win, 'links.mjs', { side: 'right' }))
    await wait(1800)
    await shot('hero')
    if (theme === 'dark') return

    await step('tools', () => clickText(win, ui.toolSummary, { exact: false }))
    await wait(1500)
    await shot('tools')

    await step('files', () => clickText(win, ui.files, { side: 'right' }))
    await wait(1200)
    await step('src', () => clickText(win, 'src', { side: 'right' }))
    await wait(1000)
    await step('file', () => clickText(win, 'links.mjs', { side: 'right' }))
    await wait(2500)
    await shot('files')

    await step('tree', () => clickText(win, 'Tree', { side: 'right' }))
    await wait(1800)
    await shot('tree')

    await step('run', () => clickText(win, 'Run', { side: 'right' }))
    await wait(1800)
    await shot('run')

    await step('context', () => clickText(win, 'Context', { side: 'right' }))
    await wait(1800)
    await shot('context')

    await step('composer', () => win.locator('[contenteditable="true"]').last().click())
    await wait(300)
    await win.keyboard.type(text(lang).mentionBefore)
    await win.keyboard.type('@li')
    await wait(1800)
    await shot('mention')
    await win.keyboard.press('Enter')
    await win.keyboard.type(text(lang).mentionAfter)
    await wait(800)
    await shot('mention-chip')
    await win.keyboard.press('Control+A')
    await win.keyboard.press('Backspace')
    await wait(300)

    await step('review', () => clickText(win, 'Review', { side: 'right' }))
    await wait(600)
    await win.mouse.move(SPLITTER.x, SPLITTER.y)
    await win.mouse.down()
    await win.mouse.move(SPLITTER.wideX, SPLITTER.y, { steps: 8 })
    await win.mouse.up()
    await wait(800)
    await step('git-wide', () => clickText(win, 'Git', { side: 'right' }))
    await wait(1200)
    const diffOpen = await win.evaluate(() => document.body.innerText.includes('@@ -1,10 +1,11 @@'))
    if (!diffOpen) await step('diff-wide', () => clickText(win, 'links.mjs', { side: 'right' }))
    await wait(1200)
    await step('split', () => win.locator('button[aria-label="Switch to side-by-side"], button[aria-label="切换到并排视图"]').first().click())
    await wait(1500)
    await shot('review-wide')

    await step('settings', () => clickText(win, ui.settings))
    await wait(2000)
    await step('appearance', () => clickText(win, ui.appearance))
    await wait(1800)
    await shot('appearance')
  } finally {
    await app.close()
  }
}
