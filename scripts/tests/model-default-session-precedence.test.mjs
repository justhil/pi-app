import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Pi default model precedence', () => {
  it('should_persist_defaults_without_mutating_the_current_live_session', () => {
    const workerSource = readFileSync(
      join(root, 'src/worker/handlers/worker-handlers-pi-settings.ts'),
      'utf8',
    )
    const patchSource = readFileSync(
      join(root, 'src/worker/pi-settings-patch.ts'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(root, 'src/renderer/src/features/settings/pi-settings-panel.tsx'),
      'utf8',
    )

    assert.doesNotMatch(
      workerSource,
      /st\.session\.setModel\(/,
      'pi.settings.set must not change the current live session model',
    )
    assert.doesNotMatch(
      rendererSource,
      /applyPiDefaultModelToWorkerSession/,
      'Settings save must not invoke Renderer model.set for the current session',
    )
    assert.match(rendererSource, /refreshComposer:\s*refreshComposerRunDisplay/)
    assert.match(workerSource, /applyPiSettingsPatch\(sm, patch\)/)
    assert.match(patchSource, /sm\.setDefaultModelAndProvider\(/)
  })
})
