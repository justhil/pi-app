import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The built-in Purge personas ship in the upstream language (Chinese). The composer chip, the
 * composer persona menu and the Settings list show `i18n[language]` when the app speaks en/ru,
 * so every built-in carries en/zh/ru display copy. The prompt body stays untranslated by design:
 * translating it would change what the agent is told.
 */
const SRC = readFileSync(join(process.cwd(), 'packages/shared/agent-purge-presets.ts'), 'utf8')

const LANGS = ['en', 'zh', 'ru']
const CJK = /[\u4e00-\u9fff]/
const CYRILLIC = /[\u0400-\u04ff]/

function presets() {
  const starts = [...SRC.matchAll(/\n\s*"id":\s*"([a-z0-9]+)"/g)]
  return starts.map((m, i) => ({
    id: m[1],
    chunk: SRC.slice(m.index, starts[i + 1] ? starts[i + 1].index : SRC.length),
  }))
}

describe('built-in Purge persona display copy', () => {
  it('every built-in carries en, zh and ru name+description', () => {
    const list = presets()
    assert.equal(list.length, 3, `expected 3 built-in personas, got ${list.length}`)
    for (const { id, chunk } of list) {
      const i18nStart = chunk.indexOf('"i18n"')
      assert.ok(i18nStart > 0, `${id} has no i18n display copy`)
      const i18nBlock = chunk.slice(i18nStart)
      for (const language of LANGS) {
        const m = new RegExp(
          `"${language}": \\{ "name": "([^"]*)", "description": "([^"]*)" \\}`,
        ).exec(i18nBlock)
        assert.ok(m, `${id} is missing the ${language} name+description pair`)
        assert.ok(m[1].trim().length >= 2, `${id} ${language} name is too short`)
        assert.ok(m[2].trim().length > 20, `${id} ${language} description is too short`)
      }
    }
  })

  it('English copy has no Chinese characters and Russian copy is Cyrillic', () => {
    for (const { id, chunk } of presets()) {
      const en = new RegExp('"en": \\{ "name": "([^"]*)"').exec(chunk)
      const ru = new RegExp('"ru": \\{ "name": "([^"]*)"').exec(chunk)
      const zh = new RegExp('"zh": \\{ "name": "([^"]*)"').exec(chunk)
      assert.ok(en && !CJK.test(en[1]), `${id} English name still carries Chinese: ${en?.[1]}`)
      assert.ok(ru && CYRILLIC.test(ru[1]), `${id} Russian name is not Cyrillic: ${ru?.[1]}`)
      assert.ok(zh && CJK.test(zh[1]), `${id} Chinese name lost its source text: ${zh?.[1]}`)
    }
  })

  it('the prompt body is not localized', () => {
    assert.match(SRC, /`body` stays the prompt text itself and is never\r?\n \* localized/)
    assert.ok(!/"bodyI18n"|"body_i18n"/.test(SRC), 'a localized body appeared - that changes the prompt')
  })
})
