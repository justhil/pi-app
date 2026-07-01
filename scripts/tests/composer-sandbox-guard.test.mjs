import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('composer worker IPC guard', () => {
  it('skips refresh when ephemeralSandboxDraft or pendingNew', () => {
    const src = readFileSync(join(process.cwd(), 'src/renderer/src/features/composer/composer.tsx'), 'utf8')
    assert.match(src, /ephemeralSandboxDraft/)
    assert.match(src, /pendingNew/)
    assert.match(src, /!currentSessionId \|\| pendingNew \|\| ephemeralSandboxDraft/)
  })
})