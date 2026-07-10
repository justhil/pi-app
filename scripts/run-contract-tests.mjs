#!/usr/bin/env node
/**
 * Contract test runner.
 * Windows CI: spawning `node --test` with dozens of absolute paths can hit
 * CreateProcess command-line limits and/or produce flaky multi-file runs.
 * Always batch files so each spawn stays well under the ~8k Windows limit.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = join(process.cwd(), 'scripts/tests')
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(dir, name))

if (files.length === 0) {
  console.error('[test:scripts] no *.test.mjs files')
  process.exit(1)
}

/** Keep each spawn argv short (paths + node binary + flags). */
const FILES_PER_BATCH = process.platform === 'win32' ? 12 : 40

let exitCode = 0
let totalBatches = 0
for (let offset = 0; offset < files.length; offset += FILES_PER_BATCH) {
  const batch = files.slice(offset, offset + FILES_PER_BATCH)
  totalBatches += 1
  const result = spawnSync(process.execPath, ['--test', ...batch], {
    stdio: 'inherit',
    env: process.env,
    // Prefer array argv (no shell) so Windows does not re-escape paths.
    shell: false,
    windowsHide: true,
  })
  if (result.error) {
    console.error('[test:scripts] spawn failed:', result.error)
    exitCode = 1
    break
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    exitCode = result.status
    // Continue remaining batches so CI logs show all failures, not just the first batch.
  }
}

if (exitCode !== 0) {
  console.error(`[test:scripts] failed after ${totalBatches} batch(es), ${files.length} files`)
}
process.exit(exitCode)
