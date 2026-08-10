import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslSync: vi.fn(),
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslSync: mocks.runWslSync,
  runWslDistroSync: vi.fn(),
  runWslDistroCdSync: vi.fn(),
  wslHomeDirSync: vi.fn(),
}))

import { listWslDistros } from '../wsl/detection'

describe('listWslDistros', () => {
  it('parses a clean JSON listing when --format json is supported', () => {
    mocks.runWslSync.mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({
        default: 'Debian',
        distributions: [{ name: 'Debian', version: 2, default: true }],
      }),
      stderr: '',
    })
    const distros = listWslDistros()
    expect(distros).toEqual([{ name: 'Debian', version: 2, isDefault: true }])
  })

  it('falls back to the quiet listing and yields clean names without a phantom entry', () => {
    mocks.runWslSync
      .mockReturnValueOnce({ status: -1, stdout: '', stderr: '无效的命令行参数： --format' })
      .mockReturnValueOnce({ status: 0, stdout: 'Debian\r\n', stderr: '' })
    const distros = listWslDistros()
    expect(distros).toEqual([{ name: 'Debian', isDefault: false }])
  })

  it('strips BOM / control-char artifacts and the NAME header from the quiet listing', () => {
    mocks.runWslSync
      .mockReturnValueOnce({ status: -1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'NAME\r\n\uFEFFDebian\r\n\x00\r\n', stderr: '' })
    const distros = listWslDistros()
    expect(distros.map((d) => d.name)).toEqual(['Debian'])
  })
})
