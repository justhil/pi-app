import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locale key parity.
 *
 * en is the source of truth (`fallbackLng: 'en'`), zh ships the full set, ru is being
 * filled namespace by namespace. A namespace in PENDING_RU only has to exist; the moment
 * its translations start landing they are checked strictly, so the list can only shrink.
 * Plural suffixes (_one/_other for en, _one/_few/_many for ru) collapse to the base key.
 * KEEP_AS_IS lists the values that are intentionally left in Latin script (product name).
 */
const PENDING_RU = []

const LOCALES_DIR = join(process.cwd(), 'src/renderer/src/locales')

const KEEP_AS_IS = new Set(['app.name'])

/**
 * Latin terms and brand names left untranslated by design (panel names, protocols,
 * key combos, search engines). An ru value identical to en is only accepted when
 * every latin word in it is listed here - that keeps the guard from firing on
 * strings like "AI · {{action}}" while still catching whole untranslated sentences.
 */
const UNTRANSLATED_TERMS = new Set([
  'AI',
  'API',
  'API Key',
  'ASR',
  'Acrylic',
  'Adapters',
  'Alt',
  'Amp',
  'Baidu',
  'Bing',
  'Board',
  'Brand',
  'Browser',
  'CLI',
  'CSV',
  'ChatGPT',
  'Chrome',
  'Claude',
  'Code',
  'Codemod',
  'Codemode',
  'Codex',
  'Context',
  'Ctrl',
  'Dark',
  'Desktop',
  'DevTools',
  'Developer',
  'DuckDuckGo',
  'English',
  'Esc',
  'Files',
  'Fluent',
  'GB',
  'GLM',
  'GPU',
  'Git',
  'GitHub',
  'Glass',
  'Google',
  'HEAD',
  'HTTP',
  'Headless',
  'Hugeicons',
  'ID',
  'Iconoir',
  'JSON',
  'KPI',
  'Key',
  'Light+',
  'Linear',
  'Liquid',
  'Live',
  'Load',
  'Lucide',
  'MB',
  'MCP',
  'Markdown',
  'Max',
  'Mica',
  'Night',
  'OAuth',
  'OK',
  'P50',
  'P90',
  'PDF',
  'Panel',
  'Phosphor',
  'Pi',
  'Pine',
  'Purge',
  'Review',
  'Ros',
  'Run',
  'Runtime',
  'SDK',
  'Search',
  'Serif',
  'Settings',
  'Shift',
  'Split',
  'Studio',
  'TPS',
  'TTFT',
  'TUI',
  'Tab',
  'Tabbed',
  'Tailscale',
  'Theme',
  'Timeline',
  'Tokyo',
  'Tools',
  'Tree',
  'Trellis',
  'UI',
  'URL',
  'Unified',
  'Usage',
  'VPN',
  'VS',
  'WSL',
  'XHigh',
  'Zhipu',
  'acc',
  'aria2',
  'aria2c',
  'brand',
  'codex-asr',
  'codex-theme-v1',
  'effort',
  'git',
  'github.com/Wangnov/codex-asr/releases/latest',
  'https',
  'hunk',
  'latest',
  'mode',
  'panel',
  'pi',
  'protocol',
  'provider/modelId',
  'reasoning',
  'reasoning_effort',
  'root',
  'serve',
  'token',
  'tokens',
  'unpacked',
  'worktree',
])

/** Latin words of a string, ignoring `{{interpolation}}` and punctuation. */
function latinWords(value) {
  return value.replace(/\{\{[^}]*\}\}/g, ' ').match(/[A-Za-z][A-Za-z0-9+./-]*/g) ?? []
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function leafPaths(node, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...leafPaths(value, path))
    else out.push(path)
  }
  return out
}

/** `dirty_one` / `dirty_few` / `dirty_other` all collapse to `dirty`. */
function basePaths(node) {
  return new Set(
    leafPaths(node).map((path) => {
      const idx = path.lastIndexOf('.')
      const name = idx < 0 ? path : path.slice(idx + 1)
      const base = name.replace(/_(one|few|many|other|two|zero)$/, '')
      return base === name ? path : `${path.slice(0, idx + 1)}${base}`
    }),
  )
}

function namespaceFiles(locale) {
  return readdirSync(join(LOCALES_DIR, locale))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
}

test('locale sets cover the same namespaces in en, zh and ru', () => {
  const en = namespaceFiles('en')
  assert.ok(en.length >= 12, `expected the 12 namespaces, got ${en.length}`)
  for (const locale of ['zh', 'ru']) {
    assert.deepEqual(namespaceFiles(locale), en, `${locale} must carry every en namespace`)
  }
})

test('zh carries every en key', () => {
  for (const ns of namespaceFiles('en')) {
    const enKeys = basePaths(loadJson(join(LOCALES_DIR, 'en', `${ns}.json`)))
    const zhKeys = basePaths(loadJson(join(LOCALES_DIR, 'zh', `${ns}.json`)))
    const missing = [...enKeys].filter((k) => !zhKeys.has(k))
    assert.deepEqual(missing, [], `zh/${ns}.json is missing: ${missing.slice(0, 10).join(', ')}`)
  }
})

test('translated ru namespaces carry every en key', () => {
  for (const ns of namespaceFiles('en')) {
    if (PENDING_RU.includes(ns)) continue
    const ruFile = join(LOCALES_DIR, 'ru', `${ns}.json`)
    const ruKeys = basePaths(loadJson(ruFile))
    const enKeys = basePaths(loadJson(join(LOCALES_DIR, 'en', `${ns}.json`)))
    const missing = [...enKeys].filter((k) => !ruKeys.has(k))
    assert.deepEqual(missing, [], `ru/${ns}.json is missing: ${missing.slice(0, 10).join(', ')}`)
  }
})

test('ru namespaces stay non-latin and never a copy of en', () => {
  for (const ns of namespaceFiles('en')) {
    if (PENDING_RU.includes(ns)) continue
    const ru = loadJson(join(LOCALES_DIR, 'ru', `${ns}.json`))
    const en = loadJson(join(LOCALES_DIR, 'en', `${ns}.json`))
    const ruLeaves = leafPaths(ru)
    const enByPath = new Map(leafPaths(en).map((p) => [p, leafValue(en, p)]))
    const copied = ruLeaves.filter((p) => {
      if (KEEP_AS_IS.has(p)) return false
      const value = leafValue(ru, p)
      const enValue = enByPath.get(p.replace(/_(one|few|many)$/, '_other')) ?? enByPath.get(p)
      // A value identical to en is a copy only when it carries latin words that are
      // not established terms (Review, MCP, Git, Chrome, aria2, Ctrl+0, …).
      return (
        typeof value === 'string' && value === enValue && latinWords(value).some((w) => !UNTRANSLATED_TERMS.has(w))
      )
    })
    assert.deepEqual(copied, [], `ru/${ns}.json copies en verbatim: ${copied.slice(0, 6).join(', ')}`)
  }
})

function leafValue(node, path) {
  const parts = path.split('.')
  let cur = node
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}
