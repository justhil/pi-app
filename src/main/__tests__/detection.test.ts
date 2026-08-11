import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslAsync: vi.fn(),
  runWslDistroAsync: vi.fn(),
  runWslDistroCdAsync: vi.fn(),
  wslHomeDirAsync: vi.fn(),
  wslDefaultShellAsync: vi.fn(),
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslAsync: mocks.runWslAsync,
  runWslDistroAsync: mocks.runWslDistroAsync,
  runWslDistroCdAsync: mocks.runWslDistroCdAsync,
  wslHomeDirAsync: mocks.wslHomeDirAsync,
  wslDefaultShellAsync: mocks.wslDefaultShellAsync,
}))

import { invalidateWslDetectionCaches, listWslDistrosAsync, probeWslDistroAsync } from '../wsl/detection'

describe('listWslDistrosAsync', () => {
  beforeEach(() => {
    invalidateWslDetectionCaches()
    mocks.runWslAsync.mockReset()
  })
  it('parses a clean JSON listing when --format json is supported', async () => {
    mocks.runWslAsync.mockReturnValueOnce(
      Promise.resolve({
        status: 0,
        stdout: JSON.stringify({
          default: 'Debian',
          distributions: [{ name: 'Debian', version: 2, default: true }],
        }),
        stderr: '',
      }),
    )
    const distros = await listWslDistrosAsync()
    expect(distros).toEqual([{ name: 'Debian', version: 2, isDefault: true }])
  })

  it('falls back to the quiet listing and yields clean names without a phantom entry', async () => {
    mocks.runWslAsync
      .mockReturnValueOnce(Promise.resolve({ status: -1, stdout: '', stderr: '无效的命令行参数： --format' }))
      .mockReturnValueOnce(Promise.resolve({ status: 0, stdout: 'Debian\r\n', stderr: '' }))
    const distros = await listWslDistrosAsync()
    expect(distros).toEqual([{ name: 'Debian', isDefault: false }])
  })

  it('strips BOM / control-char artifacts and the NAME header from the quiet listing', async () => {
    mocks.runWslAsync
      .mockReturnValueOnce(Promise.resolve({ status: -1, stdout: '', stderr: '' }))
      .mockReturnValueOnce(Promise.resolve({ status: 0, stdout: 'NAME\r\n\uFEFFDebian\r\n\x00\r\n', stderr: '' }))
    const distros = await listWslDistrosAsync()
    expect(distros.map((d) => d.name)).toEqual(['Debian'])
  })

  it('single-flights concurrent calls and caches the result within the TTL', async () => {
    mocks.runWslAsync.mockReturnValue(
      Promise.resolve({ status: 0, stdout: JSON.stringify({ distributions: [{ name: 'Debian' }] }), stderr: '' }),
    )
    const [a, b] = await Promise.all([listWslDistrosAsync(), listWslDistrosAsync()])
    expect(a).toEqual([{ name: 'Debian', isDefault: false }])
    expect(b).toEqual(a)
    expect(mocks.runWslAsync).toHaveBeenCalledTimes(1)

    await listWslDistrosAsync()
    expect(mocks.runWslAsync).toHaveBeenCalledTimes(1)
  })
})

describe('probeWslDistroAsync', () => {
    beforeEach(() => {
    invalidateWslDetectionCaches()
    mocks.runWslDistroAsync.mockReset()
    mocks.runWslDistroCdAsync.mockReset()
    mocks.wslHomeDirAsync.mockReset()
    mocks.wslDefaultShellAsync.mockReset()
    mocks.wslHomeDirAsync.mockResolvedValue('/home/u')
    mocks.wslDefaultShellAsync.mockResolvedValue('bash')
  })

  it('reports node/npm/git/pi and the --cd flag from the distro probes', async () => {
    mocks.runWslDistroCdAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    mocks.runWslDistroAsync.mockResolvedValueOnce({
      status: 0,
      stdout: '/usr/bin/node\nv22.10.0',
      stderr: '',
    })
    mocks.runWslDistroAsync.mockResolvedValueOnce({
      status: 0,
      stdout: '/usr/bin/npm\n/usr/bin/git\n/usr/local/bin/pi',
      stderr: '',
    })
    const result = await probeWslDistroAsync('Debian')
    expect(result).toMatchObject({
      ok: true,
      node: true,
      nodeVersion: '22.10.0',
      npm: true,
      git: true,
      pi: true,
      supportsCd: true,
    })
  })

  it('marks supportsCd false and still probes deps when --cd is unavailable', async () => {
    mocks.runWslDistroCdAsync.mockResolvedValue({ status: 1, stdout: '', stderr: 'no --cd' })
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/usr/bin/node\nv20.0.0\n/usr/bin/npm',
      stderr: '',
    })
    const result = await probeWslDistroAsync('Debian')
    expect(result.supportsCd).toBe(false)
    expect(result.node).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('fails fast when the distro home cannot be resolved', async () => {
    mocks.wslHomeDirAsync.mockResolvedValue(null)
    const result = await probeWslDistroAsync('Debian')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(mocks.runWslDistroCdAsync).not.toHaveBeenCalled()
    expect(mocks.runWslDistroAsync).not.toHaveBeenCalled()
  })

  it('single-flights concurrent probes for the same distro', async () => {
    mocks.runWslDistroCdAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    mocks.runWslDistroAsync.mockResolvedValue({ status: 0, stdout: '/usr/bin/node\nv20.0.0\n/usr/bin/npm', stderr: '' })
    const [a, b] = await Promise.all([probeWslDistroAsync('Debian'), probeWslDistroAsync('Debian')])
    expect(a).toEqual(b)
    expect(mocks.wslHomeDirAsync).toHaveBeenCalledTimes(1)
  })

  it('caches within TTL and force bypasses the cache', async () => {
    mocks.runWslDistroCdAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    mocks.runWslDistroAsync.mockResolvedValue({ status: 0, stdout: '/usr/bin/node\nv20.0.0\n/usr/bin/npm', stderr: '' })
    await probeWslDistroAsync('Debian')
    await probeWslDistroAsync('Debian')
    expect(mocks.wslHomeDirAsync).toHaveBeenCalledTimes(1)

    await probeWslDistroAsync('Debian', { force: true })
    expect(mocks.wslHomeDirAsync).toHaveBeenCalledTimes(2)
  })
})
