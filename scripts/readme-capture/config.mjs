import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ASSET_DIR = join(REPO, 'doc/assets/readme')
/** Logical window size; screenshots are taken at `scale` (2 → 2880×1800). */
export const VIEWPORT = { width: 1440, height: 900, scale: 2 }
export const MOCK_PORT = Number(process.env.PI_CAPTURE_MOCK_PORT || 18765)
export const LANGS = ['zh', 'en']

/** UI labels the scripts click on, per app language. */
export const UI = {
  zh: { files: '文件', toolSummary: '已编辑', settings: '设置', appearance: '外观', newSession: '新会话' },
  en: { files: 'Files', toolSummary: 'Edited', settings: 'Settings', appearance: 'Appearance', newSession: 'New session' },
}

/**
 * Crops in logical (1×) pixels of the 1440×900 window.
 * panel: the right sidebar; timeline: the chat column with expanded tool steps.
 */
export const CROPS = {
  panel: { x: 1152, y: 36, width: 288, height: 560 },
  timeline: { x: 340, y: 140, width: 680, height: 480 },
  composer: { x: 390, y: 380, width: 640, height: 500 },
}

/** Right-sidebar splitter (logical px) and the x it is dragged to for wide Review/Files demos. */
export const SPLITTER = { x: 1152, y: 420, wideX: 700 }

/** Panels shown side by side in panels.png (Review and Files have their own GIFs). The English Tree panel still has untranslated labels. */
export const PANELS = { zh: ['tree', 'run', 'context'], en: ['run', 'context'] }

export const BACKGROUND = {
  light: ['#f4f5fa', '#e3e6f1', '#3a4060'],
  dark: ['#1d1e24', '#121317', '#000000'],
}
