import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('theme startup hydrate from settings store', () => {
  it('should_hydrate_document_theme_from_settings_on_app_boot', () => {
    const appSrc = readFileSync(join(root, 'src/renderer/src/app/app.tsx'), 'utf8')
    const draftSrc = readFileSync(join(root, 'src/renderer/src/features/settings/settings-draft.ts'), 'utf8')

    assert.match(
      draftSrc,
      /export async function hydrateThemeFromSettings/,
      'settings-draft must export hydrateThemeFromSettings',
    )
    assert.match(
      draftSrc,
      /settings\.get[\s\S]*theme[\s\S]*applyThemeToDocument/,
      'hydrate must load theme from settings and apply to document',
    )
    assert.match(
      draftSrc,
      /setTheme\(/,
      'hydrate must sync ui-store theme for localStorage bootstrap',
    )
    assert.match(
      appSrc,
      /hydrateThemeFromSettings/,
      'App must call hydrateThemeFromSettings on startup so saved dark mode takes effect without opening settings',
    )
  })

  it('should_apply_theme_when_settings_draft_loads_from_disk', () => {
    const ctxSrc = readFileSync(
      join(root, 'src/renderer/src/features/settings/settings-draft-context.tsx'),
      'utf8',
    )
    assert.match(
      ctxSrc,
      /loadSettingsDraftFromDisk[\s\S]*previewDraftUi/,
      'opening settings must re-apply disk theme so selected option matches document',
    )
  })
})
