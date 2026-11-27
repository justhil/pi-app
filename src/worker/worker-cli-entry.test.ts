import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { preferUnpackedAsarPath, preparePiCliEntry } from './worker-cli-entry'

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
    expect([argv[0], await realpath(argv[1]!)]).toEqual(['pi Desktop.exe', await realpath(cli)])
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

  it('prefers app.asar.unpacked when an unpacked file exists on disk (#140)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-asar-prefer-'))
    roots.push(root)
    const asarEntry = join(root, 'resources', 'app.asar', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
    const unpackedEntry = join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
    mkdirSync(join(asarEntry, '..'), { recursive: true })
    mkdirSync(join(unpackedEntry, '..'), { recursive: true })
    writeFileSync(asarEntry, '')
    writeFileSync(unpackedEntry, '')

    expect(preferUnpackedAsarPath(asarEntry)).toBe(unpackedEntry)
    expect(preferUnpackedAsarPath(join(root, 'resources', 'app.asar', 'missing.js'))).toBe(
      join(root, 'resources', 'app.asar', 'missing.js'),
    )
    expect(preferUnpackedAsarPath(join(root, 'plain', 'index.js'))).toBe(join(root, 'plain', 'index.js'))
  })

  it('rewrites simulated app.asar SDK entry to app.asar.unpacked CLI in preparePiCliEntry (#140)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-asar-cli-'))
    roots.push(root)
    const pkgRel = join('node_modules', '@earendil-works', 'pi-coding-agent')
    const asarRoot = join(root, 'resources', 'app.asar', pkgRel)
    const unpackedRoot = join(root, 'resources', 'app.asar.unpacked', pkgRel)

    mkdirSync(join(asarRoot, 'dist', 'bundle'), { recursive: true })
    mkdirSync(join(unpackedRoot, 'dist', 'bundle'), { recursive: true })

    const manifest = JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: 'dist/bundle/cli.js' } })
    writeFileSync(join(asarRoot, 'package.json'), manifest)
    writeFileSync(join(asarRoot, 'dist', 'index.js'), '')
    writeFileSync(join(asarRoot, 'dist', 'bundle', 'cli.js'), '')

    writeFileSync(join(unpackedRoot, 'package.json'), manifest)
    writeFileSync(join(unpackedRoot, 'dist', 'index.js'), '')
    const unpackedCli = join(unpackedRoot, 'dist', 'bundle', 'cli.js')
    writeFileSync(unpackedCli, '')

    const argv = ['pi Desktop.exe', 'worker.mjs']
    await preparePiCliEntry(join(asarRoot, 'dist', 'index.js'), argv)
    expect(await realpath(argv[1]!)).toBe(await realpath(unpackedCli))
  })
})
