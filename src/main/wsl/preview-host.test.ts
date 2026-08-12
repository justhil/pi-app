import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  return {
    spawn: vi.fn(),
    wslCdFlagSupported: vi.fn(() => true),
    files,
    directories,
  }
})

vi.mock('child_process', () => ({ default: { spawn: mocks.spawn }, spawn: mocks.spawn }))
vi.mock('./worker-host', () => ({
  wslCdFlagSupported: mocks.wslCdFlagSupported,
  wslWorkerDirWsl: vi.fn(() => '/home/u/.pi-desktop'),
}))
vi.mock('../utility-entry-path', () => ({
  resolveUtilityEntry: (name: string) => join('/out/main', name),
}))
vi.mock('@shared/wsl-path', () => ({
  wslPathToWindows: (_distro: string, path: string) => path,
}))
vi.mock('fs', () => {
  const fs = {
    existsSync: (path: string) => mocks.files.has(path) || mocks.directories.has(path),
    mkdirSync: (path: string) => mocks.directories.add(path),
    readFileSync: (path: string) => {
      const value = mocks.files.get(path)
      if (value === undefined) throw new Error(`ENOENT ${path}`)
      return value
    },
    readdirSync: (path: string) => [...mocks.files.keys()]
      .filter((file) => file.startsWith(path + '/'))
      .map((file) => file.slice(path.length + 1).split('/')[0])
      .filter((name, index, names) => names.indexOf(name) === index),
    writeFileSync: (path: string, value: unknown) => mocks.files.set(path, String(value)),
  }
  return { ...fs, default: fs }
})

import { spawnPreviewInWsl, syncPreviewBundleToWsl } from './preview-host'

describe('WSL preview host', () => {
  beforeEach(() => {
    mocks.spawn.mockReset()
    mocks.files.clear()
    mocks.directories.clear()
    mocks.wslCdFlagSupported.mockReturnValue(true)
  })

  it('syncs and starts the dedicated preview entry with preview-only environment', () => {
    mocks.files.set(join('/out/main', 'preview-wsl.mjs'), 'export {}')
    mocks.files.set(join('/out/main', 'chunks', 'preview.js'), 'export const preview = true')
    mocks.spawn.mockReturnValue({})

    expect(syncPreviewBundleToWsl('Ubuntu')).toBe('/home/u/.pi-desktop/preview-wsl.mjs')
    spawnPreviewInWsl({
      distro: 'Ubuntu',
      wslCwd: '/mnt/c/Project',
      previewWslPath: '/home/u/.pi-desktop/preview-wsl.mjs',
    })

    expect([...mocks.files.entries()]).toContainEqual([
      expect.stringMatching(/home[\\/]u[\\/]\.pi-desktop[\\/]preview-wsl\.mjs$/),
      'export {}',
    ])
    expect(mocks.spawn).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '--cd', '/mnt/c/Project', '--', 'node', '/home/u/.pi-desktop/preview-wsl.mjs'],
      expect.objectContaining({
        env: expect.objectContaining({ PI_WORKER_STDIO: '1', PI_WSL_DISTRO: 'Ubuntu' }),
      }),
    )
  })
})
