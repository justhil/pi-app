import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next from 'i18next'

const root = process.cwd()
const settingsDir = join(root, 'src/renderer/src/features/settings')
const modelSettingsFiles = [
  'models-settings-panel.tsx',
  'models-sdk-provider-section.tsx',
  'models-provider-card.tsx',
  'model-catalog-picker.tsx',
  'model-entry-editor.tsx',
  'manual-model-add-dialog.tsx',
  'models-settings-shared.tsx',
  'model-id-utils.ts',
]

describe('model settings translations', () => {
  it('should_use_the_existing_settings_models_namespace', () => {
    for (const file of modelSettingsFiles) {
      const source = readFileSync(join(settingsDir, file), 'utf8')
      assert.doesNotMatch(source, /(?:\b(?:t|tr)|i18n\.t)\(\s*['"]models:/, `${file} uses a missing models namespace`)
      assert.doesNotMatch(source, /i18n\.t\(\s*['"]models\./, `${file} uses models.* without the settings namespace`)
      if (source.includes('useTranslation(')) {
        assert.match(source, /useTranslation\(\s*['"]settings['"]\s*\)/, `${file} must bind useTranslation to settings`)
      }
    }
  })

  it('should_resolve_every_referenced_model_settings_key_in_chinese_and_english', async () => {
    const resources = Object.fromEntries(
      ['zh', 'en'].map((language) => [
        language,
        {
          settings: JSON.parse(
            readFileSync(join(root, `src/renderer/src/locales/${language}/settings.json`), 'utf8'),
          ),
        },
      ]),
    )
    const referencedKeys = new Set()
    for (const file of modelSettingsFiles) {
      const source = readFileSync(join(settingsDir, file), 'utf8')
      for (const match of source.matchAll(/(?:\b(?:t|tr))\(\s*['"](models\.[^'"]+)['"]/g)) {
        referencedKeys.add(match[1])
      }
      for (const match of source.matchAll(/i18n\.t\(\s*['"]settings:(models\.[^'"]+)['"]/g)) {
        referencedKeys.add(match[1])
      }
    }
    assert.ok(referencedKeys.size > 30, 'model settings should reference the full translation surface')

    const instance = i18next.createInstance()
    await instance.init({ resources, lng: 'zh', fallbackLng: false, defaultNS: 'settings' })

    for (const language of ['zh', 'en']) {
      await instance.changeLanguage(language)
      for (const fullKey of referencedKeys) {
        const translated = instance.t(fullKey)
        assert.notEqual(translated, fullKey, `${language} settings.${fullKey} must resolve`)
        assert.ok(translated.trim(), `${language} settings.${fullKey} must not be empty`)
      }
    }
  })
})
