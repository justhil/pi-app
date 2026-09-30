import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ source: '', destination: '', probe: vi.fn(), activeWrites: 0, maxWrites: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const fs = {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      mocks.activeWrites++
      mocks.maxWrites = Math.max(mocks.maxWrites, mocks.activeWrites)
      try {
        await new Promise<void>((resolve) => setImmediate(resolve))
        return await actual.writeFile(...args)
      } finally {
        mocks.activeWrites--
      }
    },
  }
  return { ...fs, default: fs }
})
vi.mock('../utility-entry-path', () => ({ resolveUtilityEntry: (name: string) => join(mocks.source, name) }))
vi.mock('@shared/wsl-path', () => ({ wslPathToWindows: () => mocks.destination }))
vi.mock('./wsl-exec', () => ({
  wslHomeDir: async () => '/home/u',
  wslHomeDirSync: () => '/home/u',
  runWslDistroAsync: mocks.probe,
  runWslDistroCdSync: vi.fn(),
}))
vi.mock('./wsl-env', () => ({
  getCachedWslEnv: () => null,
  resolveWslEnv: async () => null,
  readWslPersisted: () => undefined,
  writeWslPersisted: vi.fn(),
  wslNodeCommand: (_distro: string, script: string) => ['node', script],
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const blocked = () => { throw new Error('synchronous startup filesystem access') }
  const fs = { ...actual, existsSync: blocked, mkdirSync: blocked, readFileSync: blocked, writeFileSync: blocked, readdirSync: blocked }
  return { ...fs, default: fs }
})

import { syncWorkerBundleToWsl } from './worker-host'
import { syncPreviewBundleToWsl } from './preview-host'
import { invalidateWslSdkResolveCache, resolveWslActiveSdk } from './sdk-resolve'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wsl-async-'))
  mocks.source = join(root, 'source')
  mocks.destination = join(root, 'destination')
  await mkdir(join(mocks.source, 'chunks'), { recursive: true })
  await writeFile(join(mocks.source, 'chunks', 'shared.js'), 'export const x = 1')
  mocks.probe.mockReset()
  mocks.activeWrites = 0
  mocks.maxWrites = 0
  invalidateWslSdkResolveCache()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('WSL startup filesystem access', () => {
  for (const [name, sync] of [
    ['worker.mjs', syncWorkerBundleToWsl],
    ['preview-wsl.mjs', syncPreviewBundleToWsl],
  ] as const) {
    it(`should_copy_asynchronously_when_${name.replaceAll('.', '_')}_starts`, async () => {
      await writeFile(join(mocks.source, name), 'export {}')
      const pending = sync('Ubuntu')
      expect(pending).toBeInstanceOf(Promise)
      await expect(pending).resolves.toBe(`/home/u/.pi-desktop/${name}`)
      expect(await readFile(join(mocks.destination, name), 'utf8')).toBe('export {}')
      expect(await readFile(join(mocks.destination, 'chunks', 'shared.js'), 'utf8')).toBe('export const x = 1')
      await expect(sync('Ubuntu')).resolves.toBe(`/home/u/.pi-desktop/${name}`)
    })
  }

  it('should_serialize_shared_chunks_when_worker_and_preview_sync_together', async () => {
    await writeFile(join(mocks.source, 'worker.mjs'), 'export {}')
    await writeFile(join(mocks.source, 'preview-wsl.mjs'), 'export {}')
    mocks.maxWrites = 0
    await Promise.all([syncWorkerBundleToWsl('Ubuntu'), syncPreviewBundleToWsl('Ubuntu')])
    expect(mocks.maxWrites).toBe(1)
    expect(await readFile(join(mocks.destination, 'worker.hash'), 'utf8')).toHaveLength(64)
    expect(await readFile(join(mocks.destination, 'preview-wsl.hash'), 'utf8')).toHaveLength(64)
  })

  it('should_resolve_sdk_asynchronously_when_probe_returns_a_package', async () => {
    await mkdir(join(mocks.destination, 'dist'), { recursive: true })
    await writeFile(join(mocks.destination, 'package.json'), JSON.stringify({ version: '0.87.1', exports: { '.': { import: './dist/index.js' } } }))
    await writeFile(join(mocks.destination, 'dist', 'index.js'), 'export {}')
    mocks.probe.mockResolvedValue({ status: 0, stdout: '/opt/pi\n', stderr: '' })
    await expect(resolveWslActiveSdk('Ubuntu')).resolves.toEqual({ packageRoot: '/opt/pi', entryPath: '/opt/pi/dist/index.js', version: '0.87.1' })
    expect(await readFile(join(mocks.destination, 'probe.sh'), 'utf8')).toContain('PKG=')
  })
})
