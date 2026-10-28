import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { preparePiCliEntry } from './worker-cli-entry'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function sdk(bin: string): { entry: string; cli: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-sdk-'))
  roots.push(root)
  mkdirSync(join(root, 'dist'), { recursive: true })
  const entry = join(root, 'dist', 'index.js')
  const cli = join(root, bin)
  mkdirSync(join(cli, '..'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: bin } }))
  writeFileSync(entry, '')
  writeFileSync(cli, '')
  return { entry, cli }
}

describe('worker Pi CLI identity', () => {
  it('should_expose_active_sdk_cli_when_worker_entry_is_not_a_pi_script', async () => {
    const { entry, cli } = sdk('dist/bundle/cli.js')
    const argv = ['pi Desktop.exe', 'worker.mjs']
    await preparePiCliEntry(entry, argv)
    expect([argv[0], realpathSync(argv[1]!)]).toEqual(['pi Desktop.exe', realpathSync(cli)])
  })

  it('should_run_the_actual_sdk_cli_with_electron_when_exposed_as_worker_identity', async () => {
    const require = createRequire(import.meta.url)
    const entry = resolve('node_modules/@earendil-works/pi-coding-agent/dist/index.js')
    const electron = require('electron') as string
    const argv = [electron, 'worker.mjs']
    await preparePiCliEntry(entry, argv)
    expect(argv[1]).not.toBe('worker.mjs')
    const child = spawnSync(electron, [argv[1], '--version'], {
      cwd: resolve('.'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout.trim()).toMatch(/\d+\.\d+\.\d+/)
  })

  it('should_leave_worker_entry_unchanged_when_sdk_cli_is_missing', async () => {
    const { entry, cli } = sdk('dist/cli.js')
    rmSync(cli)
    const argv = ['node', 'worker.mjs']
    await preparePiCliEntry(entry, argv)
    expect(argv[1]).toBe('worker.mjs')
  })

  it('should_reject_a_cli_outside_the_sdk_package', async () => {
    const { entry } = sdk('dist/cli.js')
    writeFileSync(join(entry, '..', '..', 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: '../outside.js' } }))
    const argv = ['node', 'worker.mjs']
    await preparePiCliEntry(entry, argv)
    expect(argv[1]).toBe('worker.mjs')
  })
})
