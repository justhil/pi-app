// Build a capture copy of the app and launch it offscreen with an isolated HOME / userData.
// The repo's own out/ is never touched: the build goes to <work>/app/out.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { REPO, VIEWPORT } from './config.mjs'

const require = createRequire(import.meta.url)

/** Electron binary: PI_CAPTURE_ELECTRON overrides the project's own `electron` package. */
export function electronBinary() {
  return process.env.PI_CAPTURE_ELECTRON || require('electron')
}

/** Chromium flags: offscreen rendering needs no display; Linux uses the headless ozone backend. */
export function electronFlags() {
  return [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox'] : []),
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
  ]
}

// Anchor inside the main window's webPreferences (src/main/window.ts) in the built bundle.
const OFFSCREEN_ANCHOR = 'preload: join(__dirname, "../preload/index.cjs"),'

/** electron-vite build into <work>/app/out, then make that copy render offscreen. */
export function prepareApp(work, { skipBuild = false } = {}) {
  const appDir = join(work, 'app')
  const outDir = join(appDir, 'out')
  mkdirSync(appDir, { recursive: true })
  if (!skipBuild || !existsSync(join(outDir, 'main', 'index.js'))) {
    rmSync(outDir, { recursive: true, force: true })
    execFileSync(process.execPath, [join(REPO, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', '--outDir', outDir], { cwd: REPO, stdio: 'inherit' })
  }
  const mainBundle = join(outDir, 'main', 'index.js')
  const source = readFileSync(mainBundle, 'utf8')
  if (!source.includes('offscreen: { deviceScaleFactor')) {
    if (!source.includes(OFFSCREEN_ANCHOR)) throw new Error(`readme-capture: main window webPreferences anchor not found in ${mainBundle}`)
    writeFileSync(mainBundle, source.replace(OFFSCREEN_ANCHOR, `offscreen: { deviceScaleFactor: ${VIEWPORT.scale} },\n\t\t\t${OFFSCREEN_ANCHOR}`))
  }
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ ...pkg, main: './capture-main.mjs' }, null, 2))
  writeFileSync(join(appDir, 'capture-main.mjs'), `// Capture entry: windows render offscreen and are never shown on the desktop.
import { app } from 'electron'
// Never read or write the real user's settings: userData lives inside the demo home.
if (!process.env.PI_CAPTURE_USER_DATA) throw new Error('PI_CAPTURE_USER_DATA is required')
app.setPath('userData', process.env.PI_CAPTURE_USER_DATA)
app.on('browser-window-created', (_event, win) => {
  for (const method of ['show', 'showInactive', 'focus', 'maximize']) win[method] = () => {}
  win.isVisible = () => true
  try { win.webContents.setFrameRate(30) } catch { /* window may be closing */ }
})
await import('./out/main/index.js')
`)
  for (const name of ['node_modules', 'resources']) {
    const link = join(appDir, name)
    if (!existsSync(link)) symlinkSync(join(REPO, name), link, 'junction')
  }
  return appDir
}

/**
 * Launch the capture app against a seeded demo home.
 * @param {{ appDir: string, demo: { home: string, agentDir: string, project: string }, lang: 'zh' | 'en', theme?: 'light' | 'dark' }} options
 */
export async function launchApp({ appDir, demo, lang, theme = 'light' }) {
  const configDir = join(demo.home, 'user-data')
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'pi-desktop.json'), JSON.stringify({
    language: lang,
    theme,
    currentProject: demo.project,
    recentProjects: [demo.project],
    windowBounds: { width: VIEWPORT.width, height: VIEWPORT.height },
  }, null, 2))
  const locale = lang === 'zh' ? 'zh_CN.UTF-8' : 'en_US.UTF-8'
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [...electronFlags(), `--force-device-scale-factor=${VIEWPORT.scale}`, `--lang=${lang === 'zh' ? 'zh-CN' : 'en-US'}`, appDir],
    env: {
      ...process.env,
      HOME: demo.home,
      USERPROFILE: demo.home,
      XDG_CONFIG_HOME: join(demo.home, '.config'),
      PI_CAPTURE_USER_DATA: configDir,
      PI_CODING_AGENT_DIR: demo.agentDir,
      PI_E2E: '1',
      LANG: locale,
      LC_ALL: locale,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 90_000,
  })
  const win = await app.firstWindow({ timeout: 60_000 })
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    w.webContents.setBackgroundThrottling(false)
  }, VIEWPORT)
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(3500)
  return { app, win }
}

/** Click the visible element whose own text matches; the right-most match targets the side panel. */
export async function clickText(win, label, { exact = true, side = 'left' } = {}) {
  const point = await win.evaluate(({ label, exact, side }) => {
    const nodes = [...document.querySelectorAll('body *')].filter((el) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      if (!own || (exact ? own !== label : !own.includes(label))) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.y >= 0 && r.y < innerHeight
    })
    nodes.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
    const el = side === 'right' ? nodes.at(-1) : nodes[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + Math.min(r.width / 2, 40), y: r.y + r.height / 2 }
  }, { label, exact, side })
  if (!point) throw new Error(`readme-capture: text not found: ${label}`)
  await win.mouse.click(point.x, point.y)
}
