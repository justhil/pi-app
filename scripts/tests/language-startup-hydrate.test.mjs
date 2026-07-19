import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('saved language startup hydration', () => {
  it('should_hydrate_saved_language_before_first_react_render', () => {
    const mainSource = readFileSync(join(root, 'src/renderer/src/main.tsx'), 'utf8')
    const i18nSource = readFileSync(join(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')
    const hydrationPosition = mainSource.indexOf('await hydrateLanguageFromSettings(')
    const renderPosition = mainSource.indexOf('ReactDOM.createRoot')

    assert.ok(hydrationPosition >= 0, 'renderer bootstrap must await saved language hydration')
    assert.ok(renderPosition >= 0, 'renderer bootstrap must render the React application')
    assert.ok(
      hydrationPosition < renderPosition,
      'saved language must be applied before the first React render',
    )
    assert.match(i18nSource, /settings\.get[\s\S]*key:\s*['"]language['"]/)
    assert.match(i18nSource, /await i18n\.changeLanguage/)
  })
})
