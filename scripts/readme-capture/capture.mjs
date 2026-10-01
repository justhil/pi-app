// Static screenshots of one seeded session: hero (Review → Git diff), timeline, panels, settings.
import { join } from 'node:path'
import { clickText, launchApp } from './app.mjs'
import { UI } from './config.mjs'
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

    await step('settings', () => clickText(win, ui.settings))
    await wait(2000)
    await step('appearance', () => clickText(win, ui.appearance))
    await wait(1800)
    await shot('appearance')
  } finally {
    await app.close()
  }
}
