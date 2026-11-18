import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { BUILTIN_AGENT_PURGE_PERSONAS } = await import(
  pathToFileURL(join(process.cwd(), 'packages/shared/agent-purge-presets.ts')).href
)

const LANGS = ['en', 'zh', 'ru']
const CJK = /[\u4e00-\u9fff]/
const CYRILLIC = /[\u0400-\u04ff]/

describe('built-in Purge persona localization', () => {
  it('every built-in carries en, zh and ru name, description, and body', () => {
    assert.equal(
      BUILTIN_AGENT_PURGE_PERSONAS.length,
      3,
      `expected 3 built-in personas, got ${BUILTIN_AGENT_PURGE_PERSONAS.length}`,
    )
    for (const persona of BUILTIN_AGENT_PURGE_PERSONAS) {
      assert.ok(persona.i18n, `${persona.id} has no i18n map`)
      for (const language of LANGS) {
        const entry = persona.i18n[language]
        assert.ok(entry, `${persona.id} is missing i18n.${language}`)
        assert.ok((entry.name ?? '').trim().length >= 2, `${persona.id} ${language} name is too short`)
        assert.ok(
          (entry.description ?? '').trim().length > 20,
          `${persona.id} ${language} description is too short`,
        )
        assert.ok((entry.body ?? '').trim().length > 200, `${persona.id} ${language} body is too short`)
      }
    }
  })

  it('en has zero Chinese characters, ru uses Cyrillic with zero Chinese characters, and zh retains CJK', () => {
    for (const persona of BUILTIN_AGENT_PURGE_PERSONAS) {
      const en = persona.i18n.en
      const ru = persona.i18n.ru
      const zh = persona.i18n.zh
      for (const field of ['name', 'description', 'body']) {
        assert.ok(!CJK.test(en[field]), `${persona.id} i18n.en.${field} still carries Chinese`)
        assert.ok(CYRILLIC.test(ru[field]), `${persona.id} i18n.ru.${field} is missing Cyrillic`)
        assert.ok(!CJK.test(ru[field]), `${persona.id} i18n.ru.${field} still carries Chinese`)
        assert.ok(CJK.test(zh[field]), `${persona.id} i18n.zh.${field} lost its Chinese text`)
      }
    }
  })

  it('konata carries Konata Izumi across en, zh, and ru', () => {
    const konata = BUILTIN_AGENT_PURGE_PERSONAS.find((p) => p.id === 'konata')
    assert.ok(konata)
    assert.match(konata.i18n.en.name, /Konata Izumi/)
    assert.match(konata.i18n.en.body, /Konata Izumi/)
    assert.match(konata.i18n.ru.name, /Коната Изуми/)
    assert.match(konata.i18n.ru.body, /Коната Изуми/)
    assert.match(konata.i18n.zh.name, /泉此方/)
    assert.match(konata.i18n.zh.body, /泉此方/)
  })
})
