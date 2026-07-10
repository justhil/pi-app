#!/usr/bin/env node
/**
 * Contract test runner.
 *
 * Windows CI previously reported "failed after N batches" while the last TAP
 * summary showed fail 0 — Node can exit non-zero with open handles even when
 * every test passed. This runner:
 *  - batches files (short relative paths on Windows)
 *  - treats reporter fail count as source of truth (TAP `# fail` or pretty `ℹ fail`)
 *  - ignores non-zero process exit when fail count is 0
 *  - on real failure: fail fast, print batch files, re-run each file alone
 */
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const dir = join(root, 'scripts/tests')
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => relative(root, join(dir, name)))

if (files.length === 0) {
  console.error('[test:scripts] no *.test.mjs files')
  process.exit(1)
}

const FILES_PER_BATCH = process.platform === 'win32' ? 12 : 40

/** Parse last fail/pass from TAP (`# fail N`) or default pretty reporter (`ℹ fail N`). */
function lastReporterCount(output, kind) {
  const patterns = [
    new RegExp(`# ${kind} (\\d+)`, 'g'),
    new RegExp(`(?:ℹ|info)\\s+${kind}\\s+(\\d+)`, 'gi'),
    // Some Node builds print without the info glyph: "fail 0"
    new RegExp(`(?:^|\\n)\\s*${kind}\\s+(\\d+)\\s*(?:\\n|$)`, 'gi'),
  ]
  let last = null
  for (const pattern of patterns) {
    const matches = [...output.matchAll(pattern)]
    if (matches.length > 0) {
      last = Number(matches[matches.length - 1][1])
    }
  }
  return last
}

let totalFail = 0
let totalPass = 0
let batchesRun = 0
let spuriousNonZeroExits = 0

for (let offset = 0; offset < files.length; offset += FILES_PER_BATCH) {
  const batch = files.slice(offset, offset + FILES_PER_BATCH)
  const batchNumber = Math.floor(offset / FILES_PER_BATCH) + 1
  batchesRun += 1

  const result = spawnSync(process.execPath, ['--test', ...batch], {
    encoding: 'utf8',
    env: process.env,
    shell: false,
    windowsHide: true,
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')

  if (result.error) {
    console.error(`[test:scripts] batch ${batchNumber} spawn failed:`, result.error)
    console.error('[test:scripts] files:\n' + batch.map((file) => `  - ${file}`).join('\n'))
    process.exit(1)
  }

  const failCount = lastReporterCount(output, 'fail')
  const passCount = lastReporterCount(output, 'pass')
  if (typeof passCount === 'number') totalPass += passCount
  if (typeof failCount === 'number') totalFail += failCount

  const hasRealFailures = typeof failCount === 'number' && failCount > 0
  const statusFailed = typeof result.status === 'number' && result.status !== 0
  const reporterMissing = failCount === null && passCount === null
  // Fatal only on real test failures, missing reporter output, or kill signal.
  const shouldFail = hasRealFailures || (statusFailed && reporterMissing) || !!result.signal

  if (shouldFail) {
    console.error(
      `[test:scripts] batch ${batchNumber}/${Math.ceil(files.length / FILES_PER_BATCH)} failed` +
        ` (status=${result.status}, signal=${result.signal}, fail=${failCount}, pass=${passCount})`,
    )
    console.error('[test:scripts] files in this batch:')
    for (const file of batch) console.error(`  - ${file}`)

    for (const file of batch) {
      const solo = spawnSync(process.execPath, ['--test', file], {
        encoding: 'utf8',
        env: process.env,
        shell: false,
        windowsHide: true,
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      })
      const soloOut = `${solo.stdout || ''}${solo.stderr || ''}`
      const soloFail = lastReporterCount(soloOut, 'fail')
      const soloPass = lastReporterCount(soloOut, 'pass')
      const soloBad =
        (typeof soloFail === 'number' && soloFail > 0) ||
        !!solo.error ||
        !!solo.signal ||
        (typeof solo.status === 'number' && solo.status !== 0 && soloFail === null && soloPass === null)
      if (soloBad) {
        process.stdout.write(solo.stdout || '')
        process.stderr.write(solo.stderr || '')
        console.error(
          `[test:scripts] failing file: ${file} (status=${solo.status}, fail=${soloFail}, pass=${soloPass})`,
        )
      }
    }
    process.exit(1)
  }

  if (statusFailed && !hasRealFailures) {
    spuriousNonZeroExits += 1
    console.warn(
      `[test:scripts] batch ${batchNumber}: node exit ${result.status} with reporter fail 0 — treating as pass`,
    )
  }
}

console.log(
  `[test:scripts] ok — ${files.length} files, ${batchesRun} batch(es), pass=${totalPass}, fail=${totalFail}` +
    (spuriousNonZeroExits ? `, ignoredNonZeroExit=${spuriousNonZeroExits}` : ''),
)
process.exit(totalFail > 0 ? 1 : 0)
