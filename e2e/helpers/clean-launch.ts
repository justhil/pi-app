import { _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainEntry = path.join(root, 'out', 'main', 'index.js')

const CHROMIUM_LANG = { en: 'en-US', zh: 'zh-CN', ru: 'ru-RU' } as const
const tempDirs: string[] = []
process.on('exit', () => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Launch the built app with an isolated userData and a pinned UI language.
 *
 * Specs that only set XDG_CONFIG_HOME get no isolation on Windows: the app then reads
 * the machine's real pi-desktop.json and falls back to the OS locale, so a Russian
 * Windows install renders Russian labels and the selectors stop matching. Pinning
 * --user-data-dir + language (and --lang for navigator.language) makes launches
 * deterministic on any machine.
 */
export async function launchCleanApp(
  opts: { language?: 'en' | 'zh' | 'ru'; env?: Record<string, string>; args?: string[]; config?: Record<string, unknown> } = {},
): Promise<ElectronApplication> {
  const language = opts.language ?? 'en'
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-locale-'))
  tempDirs.push(configDir)
  fs.writeFileSync(
    path.join(configDir, 'pi-desktop.json'),
    JSON.stringify({ language, windowBounds: { width: 1400, height: 900 }, ...opts.config }),
  )
  return electron.launch({
    executablePath: electronExecutable,
    args: [
      mainEntry,
      '--ozone-platform=x11',
      `--lang=${CHROMIUM_LANG[language]}`,
      `--user-data-dir=${configDir}`,
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      ...(opts.args ?? []),
    ],
    env: { ...process.env, PI_E2E: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...(opts.env ?? {}) },
    timeout: 60_000,
  })
}
