import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const checklist = [
  ['F-01', 'scripts/ci-audit.mjs'],
  ['F-02', 'scripts/tests/ipc-capability-boundaries.test.mjs'],
  ['F-03', 'scripts/tests/asr-secret-redaction.test.mjs'],
  ['F-04', 'scripts/tests/ipc-schema-validation.test.mjs'],
  ['F-05', 'scripts/tests/ipc-capability-boundaries.test.mjs'],
  ['F-06', 'scripts/tests/ipc-capability-boundaries.test.mjs'],
  ['F-07', 'scripts/tests/ipc-capability-boundaries.test.mjs'],
  ['F-08', 'src/main/sdk-manager.ts'],
  ['F-09', 'electron.vite.config.ts'],
  ['F-10', 'scripts/tests/generate-release-checksums.test.mjs'],
  ['F-11', 'scripts/tests/fmsm-a-rating-checklist.test.mjs'],
  ['F-12', 'src/main/operation-events.ts'],
  ['F-13', 'scripts/ci-audit.mjs'],
  ['F-14', 'scripts/tests/ui-store-persist-boundary.test.mjs'],
  ['H-01', 'scripts/tests/release-job-checkout.test.mjs'],
  ['M-01', 'scripts/tests/asr-overlay-lifecycle.test.mjs'],
  ['M-02', 'scripts/tests/clipboard-retention-policy.test.mjs'],
  ['M-03', 'scripts/tests/ipc-capability-boundaries.test.mjs'],
]

describe('FMSM A-rating verification checklist', () => {
  for (const [id, rel] of checklist) {
    it(`${id} has verification surface ${rel}`, () => {
      assert.ok(existsSync(join(root, rel)), `${id}: missing ${rel}`)
    })
  }
})