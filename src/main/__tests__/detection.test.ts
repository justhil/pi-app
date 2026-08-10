import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslAsync: vi.fn(),
  runWslDistroAsync: vi.fn(),
  runWslDistroCdAsync: vi.fn(),
  wslHomeDir: vi.fn(),
  wslDefaultShell: vi.fn(),
}))

vi.mock('../wsl/wsl-exec', () => ({
  isValidWslDistroName: (distro: string) => /^[A-Za-z0-9._-]+$/.test(distro),
  runWslAsync: mocks.runWslAsync,
  runWslDistroAsync: mocks.runWslDistroAsync,
  runWslDistroCdAsync: mocks.runWslDistroCdAsync,
  wslHomeDir: mocks.wslHomeDir,
  wslDefaultShell: mocks.wslDefaultShell,
}))

import { listWslDistros } from '../wsl/detection'

describe('listWslDistros', () => {
  it('uses only the async WSL process adapter', async () => {
    mocks.runWslAsync.mockResolvedValueOnce({
      status: 0,
      stdout: '{"distributions":[{"name":"Debian"}]}',
      stderr: '',
    })

    await listWslDistros()

    expect(mocks.runWslAsync).toHaveBeenCalledWith(['--list', '--format', 'json'], { timeout: 15000 })
  })

  it('parses a clean JSON listing when --format json is supported', async () => {
    mocks.runWslAsync.mockResolvedValueOnce({
      status: 0,
      stdout: JSON.stringify({
        default: 'Debian',
        distributions: [{ name: 'Debian', version: 2, default: true }],
      }),
      stderr: '',
    })
    const distros = await listWslDistros()
    expect(distros).toEqual([{ name: 'Debian', version: 2, isDefault: true }])
  })

  it('falls back to the quiet listing and yields clean names without a phantom entry', async () => {
    mocks.runWslAsync
      .mockResolvedValueOnce({ status: -1, stdout: '', stderr: '无效的命令行参数： --format' })
      .mockResolvedValueOnce({ status: 0, stdout: 'Debian\r\n', stderr: '' })
    const distros = await listWslDistros()
    expect(distros).toEqual([{ name: 'Debian', isDefault: false }])
  })

  it('strips BOM / control-char artifacts and the NAME header from the quiet listing', async () => {
    mocks.runWslAsync
      .mockResolvedValueOnce({ status: -1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ status: 0, stdout: 'NAME\r\n\uFEFFDebian\r\n\x00\r\n', stderr: '' })
    const distros = await listWslDistros()
    expect(distros.map((d) => d.name)).toEqual(['Debian'])
  })
})
