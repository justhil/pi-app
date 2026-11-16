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
const PENDING_RU = ['settings']

const LOCALES_DIR = join(process.cwd(), 'src/renderer/src/locales')

const KEEP_AS_IS = new Set(['app.name'])

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
      // Terms kept on purpose (panel names, MCP, Git, worktree, …) are short single words.
      return typeof value === 'string' && value === enValue && value.split(/\s+/).length > 1
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
