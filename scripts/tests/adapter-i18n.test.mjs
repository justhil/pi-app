import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const builtinDir = join(root, 'src/extension-compat/builtin')
const schemaPath = join(root, 'src/extension-compat/adapter-schema.ts')

const CJK_RE = /[\u4e00-\u9fff]/
const CYRILLIC_RE = /[\u0400-\u04ff]/

/** Mirror `resolveAdapterText` in `src/extension-compat/adapter-schema.ts`. */
function resolveAdapterText(a, language) {
  const lang = language.slice(0, 2).toLowerCase()
  const exact = a.i18n?.[language]
  const base = a.i18n?.[lang]
  const enFallback = lang !== 'zh' ? a.i18n?.en : undefined
  return {
    displayName: exact?.displayName ?? base?.displayName ?? enFallback?.displayName ?? a.displayName,
    description: exact?.description ?? base?.description ?? enFallback?.description ?? a.description,
    note:
      a.config?.i18n?.[language]?.note ??
      a.config?.i18n?.[lang]?.note ??
      exact?.note ??
      base?.note ??
      (lang !== 'zh' ? (a.config?.i18n?.en?.note ?? enFallback?.note) : undefined) ??
      a.config?.note,
    sections: (a.config?.sections ?? []).map((s) => ({
      title:
        s.i18n?.[language]?.title ??
        s.i18n?.[lang]?.title ??
        (lang !== 'zh' ? s.i18n?.en?.title : undefined) ??
        s.title,
      fields: (s.fields ?? []).map((f) => ({
        ...f,
        label: exact?.fieldLabels?.[f.key] ?? base?.fieldLabels?.[f.key] ?? enFallback?.fieldLabels?.[f.key] ?? f.label,
        description:
          exact?.fieldDescriptions?.[f.key] ??
          base?.fieldDescriptions?.[f.key] ??
          enFallback?.fieldDescriptions?.[f.key] ??
          f.description,
      })),
    })),
    actions: (a.config?.actions ?? []).map((act) => ({
      id: act.id,
      label: exact?.actionLabels?.[act.id] ?? base?.actionLabels?.[act.id] ?? enFallback?.actionLabels?.[act.id] ?? act.label,
    })),
    sidePanel: {
      label: exact?.sidePanel?.label ?? base?.sidePanel?.label ?? enFallback?.sidePanel?.label ?? a.sidePanel?.label,
      description:
        exact?.sidePanel?.description ??
        base?.sidePanel?.description ??
        enFallback?.sidePanel?.description ??
        a.sidePanel?.description,
    },
  }
}

function collectResolvedStrings(resolved) {
  const strings = []
  const push = (label, value) => {
    if (typeof value === 'string' && value.length > 0) strings.push([label, value])
  }
  push('displayName', resolved.displayName)
  push('description', resolved.description)
  push('note', resolved.note)
  resolved.sections.forEach((sec, si) => {
    push(`sections[${si}].title`, sec.title)
    sec.fields.forEach((field) => {
      push(`sections[${si}].fields.${field.key}.label`, field.label)
      push(`sections[${si}].fields.${field.key}.description`, field.description)
    })
  })
  resolved.actions.forEach((act) => {
    push(`actions.${act.id}.label`, act.label)
  })
  push('sidePanel.label', resolved.sidePanel.label)
  push('sidePanel.description', resolved.sidePanel.description)
  return strings
}

describe('built-in adapter i18n coverage & fallback', () => {
  const files = readdirSync(builtinDir)
    .filter((name) => name.endsWith('.adapter.json'))
    .sort()

  it('ships at least 27 built-in adapters', () => {
    assert.ok(files.length >= 27, `expected >= 27 built-in adapters, found ${files.length}`)
  })

  it('resolveAdapterText in adapter-schema.ts normalizes lang and falls back to en for non-zh', () => {
    const src = readFileSync(schemaPath, 'utf8')
    assert.match(src, /language\.slice\(0,\s*2\)\.toLowerCase\(\)/)
    assert.match(src, /lang !== 'zh'/)
  })

  it('falls back to English before root Chinese strings for non-zh languages', () => {
    const sample = {
      id: 'sample',
      displayName: '示例',
      description: '中文描述',
      config: {
        note: '中文说明',
        i18n: {
          en: { note: 'English note' },
        },
        sections: [
          {
            title: '中文标题',
            fields: [{ key: 'k', type: 'text', label: '中文标签', description: '中文字段说明' }],
            i18n: { en: { title: 'English title' } },
          },
        ],
        actions: [{ id: 'test', type: 'reload', label: '测试' }],
      },
      sidePanel: { panelComponent: 'list', source: { type: 'json', path: 'x.json' }, label: '面板', description: '面板说明' },
      i18n: {
        en: {
          displayName: 'Sample',
          description: 'English description',
          fieldLabels: { k: 'English label' },
          fieldDescriptions: { k: 'English field desc' },
          actionLabels: { test: 'Test' },
          sidePanel: { label: 'Panel', description: 'Panel desc' },
        },
        ru: {
          displayName: 'Пример',
        },
      },
    }

    const ruResolved = resolveAdapterText(sample, 'ru-RU')
    assert.equal(ruResolved.displayName, 'Пример')
    assert.equal(ruResolved.description, 'English description')
    assert.equal(ruResolved.note, 'English note')
    assert.equal(ruResolved.sections[0].title, 'English title')
    assert.equal(ruResolved.sections[0].fields[0].label, 'English label')
    assert.equal(ruResolved.sections[0].fields[0].description, 'English field desc')
    assert.equal(ruResolved.actions[0].label, 'Test')
    assert.equal(ruResolved.sidePanel.label, 'Panel')
    assert.equal(ruResolved.sidePanel.description, 'Panel desc')

    const frResolved = resolveAdapterText(sample, 'FR')
    assert.equal(frResolved.displayName, 'Sample')
    assert.equal(frResolved.description, 'English description')
    assert.equal(frResolved.note, 'English note')

    const zhResolved = resolveAdapterText(sample, 'zh-CN')
    assert.equal(zhResolved.displayName, '示例')
    assert.equal(zhResolved.description, '中文描述')
    assert.equal(zhResolved.note, '中文说明')
  })

  it('provides complete zh, en, and ru i18n for every built-in adapter without CJK leakage', () => {
    for (const file of files) {
      const raw = readFileSync(join(builtinDir, file), 'utf8')
      const adapter = JSON.parse(raw)

      for (const locale of ['zh', 'en', 'ru']) {
        assert.ok(adapter.i18n?.[locale], `${file}: missing i18n.${locale}`)
        assert.ok(adapter.i18n[locale].displayName, `${file}: missing i18n.${locale}.displayName`)
        assert.ok(adapter.i18n[locale].description, `${file}: missing i18n.${locale}.description`)

        if (adapter.config?.note) {
          assert.ok(
            adapter.config?.i18n?.[locale]?.note || adapter.i18n?.[locale]?.note,
            `${file}: missing config.i18n.${locale}.note`,
          )
        }

        for (const [idx, sec] of (adapter.config?.sections ?? []).entries()) {
          if (sec.title) {
            assert.ok(sec.i18n?.[locale]?.title, `${file}: missing sections[${idx}].i18n.${locale}.title`)
          }
          for (const field of sec.fields ?? []) {
            if (field.label) {
              assert.ok(
                adapter.i18n[locale].fieldLabels?.[field.key],
                `${file}: missing i18n.${locale}.fieldLabels.${field.key}`,
              )
            }
            if (field.description) {
              assert.ok(
                adapter.i18n[locale].fieldDescriptions?.[field.key],
                `${file}: missing i18n.${locale}.fieldDescriptions.${field.key}`,
              )
            }
          }
        }

        for (const act of adapter.config?.actions ?? []) {
          if (act.label) {
            assert.ok(
              adapter.i18n[locale].actionLabels?.[act.id],
              `${file}: missing i18n.${locale}.actionLabels.${act.id}`,
            )
          }
        }

        if (adapter.sidePanel) {
          if (adapter.sidePanel.label) {
            assert.ok(
              adapter.i18n[locale].sidePanel?.label,
              `${file}: missing i18n.${locale}.sidePanel.label`,
            )
          }
          if (adapter.sidePanel.description) {
            assert.ok(
              adapter.i18n[locale].sidePanel?.description,
              `${file}: missing i18n.${locale}.sidePanel.description`,
            )
          }
        }
      }

      for (const targetLang of ['en', 'ru', 'fr']) {
        const resolved = resolveAdapterText(adapter, targetLang)
        for (const [keyPath, value] of collectResolvedStrings(resolved)) {
          assert.equal(
            CJK_RE.test(value),
            false,
            `${file} (${targetLang}) leaked CJK in ${keyPath}: ${value}`,
          )
        }
      }

      const ruResolved = resolveAdapterText(adapter, 'ru')
      assert.match(
        ruResolved.description ?? '',
        CYRILLIC_RE,
        `${file}: ru description must contain Cyrillic`,
      )
      if (adapter.config?.note) {
        assert.match(
          ruResolved.note ?? '',
          CYRILLIC_RE,
          `${file}: ru note must contain Cyrillic`,
        )
      }
    }
  })
})
