import { describe, expect, it, vi, beforeEach } from 'vitest'
import { join } from 'path'

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return {
    spawn: vi.fn(),
    runWslDistroCdSync: vi.fn(),
    wslPathToWindows: vi.fn((_distro: string, _wslPath: string) => '/root/.pi-desktop'),
    fs: {
      existsSync: (p: string) => {
        const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '')
        const n = norm(p)
        if (dirs.has(p) || files.has(p)) return true
        for (const f of files.keys()) {
          if (norm(f).startsWith(n + '/')) return true
        }
        return false
      },
      mkdirSync: (p: string) => {
        dirs.add(p)
      },
      readFileSync: (p: string) => {
        const c = files.get(p)
        if (c === undefined) throw new Error(`ENOENT ${p}`)
        return c
      },
      writeFileSync: (p: string, data: unknown) => {
        files.set(p, String(data))
        dirs.add(p)
      },
      readdirSync: (p: string) => {
        const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '')
        const n = norm(p)
        return [...files.keys()]
          .filter((f) => norm(f).startsWith(n + '/'))
          .map((f) => norm(f).slice(n.length + 1).split('/')[0])
          .filter((name, i, arr) => arr.indexOf(name) === i)
      },
      files,
      dirs,
    },
  }
})

vi.mock('child_process', () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}))

vi.mock('../utility-entry-path', () => ({
  resolveUtilityEntry: (entryName: string) => join(process.cwd(), 'src/main/wsl', entryName),
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslDistroCdSync: mocks.runWslDistroCdSync,
  wslHomeDirSync: vi.fn(() => '/root'),
}))

vi.mock('@shared/wsl-path', () => ({
  wslPathToWindows: mocks.wslPathToWindows,
}))

vi.mock('fs', () => {
  const fns = {
    existsSync: mocks.fs.existsSync,
    mkdirSync: mocks.fs.mkdirSync,
    readFileSync: mocks.fs.readFileSync,
    writeFileSync: mocks.fs.writeFileSync,
    readdirSync: mocks.fs.readdirSync,
  }
  return { ...fns, default: fns }
})

import { spawnWorkerInWsl, wslCdFlagSupported, syncWorkerBundleToWsl, invalidateWslCdSupportCache } from '../wsl/worker-host'

const WSL_DIR = join(process.cwd(), 'src/main/wsl')
const unc = (...parts: string[]): string => join('/', ...parts)

beforeEach(() => {
  mocks.spawn.mockReset()
  invalidateWslCdSupportCache()
  mocks.runWslDistroCdSync.mockReset()
  mocks.runWslDistroCdSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
  mocks.fs.files.clear()
  mocks.fs.dirs.clear()
})

describe('spawnWorkerInWsl', () => {
  it('places --cd after the distro name (before --)', () => {
    mocks.spawn.mockReturnValue({})
    spawnWorkerInWsl({ distro: 'Debian', wslCwd: '/home/u/proj', workerWslPath: '/root/.pi-desktop/worker.mjs' })
    const [exe, args, opts] = mocks.spawn.mock.calls[0]
    expect(exe).toBe('wsl.exe')
    expect(args).toEqual([
      '-d',
      'Debian',
      '--cd',
      '/home/u/proj',
      '--',
      'node',
      '/root/.pi-desktop/worker.mjs',
    ])
    expect(opts.env.PI_WORKER_STDIO).toBe('1')
    expect(opts.env.PI_WSL_DISTRO).toBe('Debian')
    expect(opts.env.WSLENV).toContain('PI_WORKER_STDIO')
    expect(opts.env.WSLENV).toContain('PI_WSL_DISTRO')
  })

  it('merges worker vars into an existing WSLENV without duplicates', () => {
    const prev = process.env.WSLENV
    process.env.WSLENV = 'MYVAR/p:PI_WORKER_STDIO'
    try {
      mocks.spawn.mockReturnValue({})
      spawnWorkerInWsl({ distro: 'Debian', wslCwd: '/', workerWslPath: '/w.mjs' })
      const [, , opts] = mocks.spawn.mock.calls[0]
      expect(opts.env.WSLENV).toBe('MYVAR/p:PI_WORKER_STDIO:PI_WSL_DISTRO')
    } finally {
      if (prev === undefined) delete process.env.WSLENV
      else process.env.WSLENV = prev
    }
  })

  it('uses an argument-safe shell cd fallback when --cd is unsupported', () => {
    mocks.runWslDistroCdSync.mockReturnValue({ status: 1, stdout: '', stderr: 'bad' })
    expect(wslCdFlagSupported('Ubuntu')).toBe(false)
    mocks.spawn.mockReturnValue({})
    spawnWorkerInWsl({
      distro: 'Ubuntu',
      wslCwd: '/home/u/项目 with spaces',
      workerWslPath: '/root/.pi-desktop/worker.mjs',
    })
    const [, args] = mocks.spawn.mock.calls[0]
    expect(args).toEqual([
      '-d',
      'Ubuntu',
      '--',
      'bash',
      '-lc',
      'cd -- "$1" && exec node "$2"',
      'bash',
      '/home/u/项目 with spaces',
      '/root/.pi-desktop/worker.mjs',
    ])
  })

  it('caches the --cd support probe per distro', () => {
    mocks.spawn.mockReturnValue({})
    spawnWorkerInWsl({ distro: 'Alpine', wslCwd: '/', workerWslPath: '/w.mjs' })
    spawnWorkerInWsl({ distro: 'Alpine', wslCwd: '/', workerWslPath: '/w.mjs' })
    expect(mocks.runWslDistroCdSync).toHaveBeenCalledTimes(1)
  })
})

describe('syncWorkerBundleToWsl', () => {
  it('copies worker.mjs plus its chunks and a type:module package.json', () => {
    mocks.fs.files.set(join(WSL_DIR, 'worker.mjs'), 'export const x = 1')
    mocks.fs.files.set(join(WSL_DIR, 'chunks', 'worker-message.js'), 'export const m = 1')
    mocks.fs.files.set(join(WSL_DIR, 'chunks', 'worker-timeline.js'), 'export const t = 1')

    const result = syncWorkerBundleToWsl('Debian')

    expect(result).toBe('/root/.pi-desktop/worker.mjs')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'worker.mjs'))).toBe('export const x = 1')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'chunks', 'worker-message.js'))).toBe('export const m = 1')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'chunks', 'worker-timeline.js'))).toBe('export const t = 1')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'package.json'))).toBe(JSON.stringify({ type: 'module' }))
  })

  it('returns null when out/main/worker.mjs is missing', () => {
    expect(syncWorkerBundleToWsl('Debian')).toBeNull()
  })

  it('skips the UNC write storm when the bundle hash is unchanged', () => {
    mocks.fs.files.set(join(WSL_DIR, 'worker.mjs'), 'export const x = 1')
    mocks.fs.files.set(join(WSL_DIR, 'chunks', 'worker-message.js'), 'export const m = 1')

    syncWorkerBundleToWsl('Debian')
    const writesAfterFirst = mocks.fs.files.size
    expect(writesAfterFirst).toBeGreaterThan(0)

    syncWorkerBundleToWsl('Debian')
    // 第二次调用不重写任何文件（worker.hash 命中即跳过）
    expect(mocks.fs.files.size).toBe(writesAfterFirst)
  })

  it('re-syncs when the local bundle hash changes', () => {
    mocks.fs.files.set(join(WSL_DIR, 'worker.mjs'), 'export const x = 1')
    mocks.fs.files.set(join(WSL_DIR, 'chunks', 'worker-message.js'), 'export const m = 1')

    syncWorkerBundleToWsl('Debian')
    const staleMarker = mocks.fs.files.get(unc('root', '.pi-desktop', 'worker.hash'))
    expect(staleMarker).toBeTruthy()

    mocks.fs.files.set(join(WSL_DIR, 'worker.mjs'), 'export const y = 2')
    syncWorkerBundleToWsl('Debian')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'worker.mjs'))).toBe('export const y = 2')
    expect(mocks.fs.files.get(unc('root', '.pi-desktop', 'worker.hash'))).not.toBe(staleMarker)
  })
})
