import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslDistroAsync: vi.fn(),
  wslHomeDirSync: vi.fn(() => '/root'),
  wslDefaultShellSync: vi.fn(() => 'bash'),
  resolvePackageEntryPath: vi.fn((uncRoot: string) => `${uncRoot}\\dist\\index.js`),
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslDistroAsync: mocks.runWslDistroAsync,
  wslHomeDirSync: mocks.wslHomeDirSync,
  wslDefaultShellSync: mocks.wslDefaultShellSync,
}))

vi.mock('../global-sdk-resolve', () => ({
  resolvePackageEntryPath: mocks.resolvePackageEntryPath,
}))

import { resolveWslActiveSdk, assertWslSdkAvailable, invalidateWslSdkResolveCache } from '../wsl/sdk-resolve'

beforeEach(() => {
  mocks.runWslDistroAsync.mockReset()
  mocks.resolvePackageEntryPath.mockReset()
  invalidateWslSdkResolveCache()
})

describe('resolveWslActiveSdk', () => {
  it('returns a WSL-native entry path using forward slashes', async () => {
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent\n',
      stderr: '',
    })
    mocks.resolvePackageEntryPath.mockReturnValue(
      '\\\\wsl.localhost\\Debian\\root\\.nvm\\versions\\node\\v24.18.0\\lib\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\index.js',
    )

    const result = await resolveWslActiveSdk('Debian')

    expect(result).not.toBeNull()
    expect(result!.packageRoot).toBe(
      '/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent',
    )
    expect(result!.entryPath).toBe(
      '/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js',
    )
    expect(result!.entryPath).not.toContain('\\')
  })

  it('returns null when the probe finds no candidates', async () => {
    mocks.runWslDistroAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    expect(await resolveWslActiveSdk('Debian')).toBeNull()
  })

  it('returns null when the package entry cannot be resolved', async () => {
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent\n',
      stderr: '',
    })
    mocks.resolvePackageEntryPath.mockReturnValue(null as unknown as string)
    expect(await resolveWslActiveSdk('Debian')).toBeNull()
  })

  it('caches the resolution per distro within the TTL window', async () => {
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/root/a/node_modules/@earendil-works/pi-coding-agent\n',
      stderr: '',
    })
    mocks.resolvePackageEntryPath.mockImplementation((uncRoot: string) => `${uncRoot}\\dist\\index.js`)

    const first = await resolveWslActiveSdk('Debian')
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/root/B/node_modules/@earendil-works/pi-coding-agent\n',
      stderr: '',
    })
    const second = await resolveWslActiveSdk('Debian')
    // 命中缓存，不再跑第二次探测
    expect(mocks.runWslDistroAsync).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(second!.packageRoot).toBe('/root/a/node_modules/@earendil-works/pi-coding-agent')

    // refresh 强制重探
    const fresh = await resolveWslActiveSdk('Debian', { refresh: true })
    expect(mocks.runWslDistroAsync).toHaveBeenCalledTimes(2)
    expect(fresh!.packageRoot).toBe('/root/B/node_modules/@earendil-works/pi-coding-agent')
  })

  it('assertWslSdkAvailable resolves and throws with the shared message when missing', async () => {
    mocks.runWslDistroAsync.mockResolvedValue({
      status: 0,
      stdout: '/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent\n',
      stderr: '',
    })
    mocks.resolvePackageEntryPath.mockReturnValue(
      '\\\\wsl.localhost\\Debian\\root\\.nvm\\versions\\node\\v24.18.0\\lib\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\index.js',
    )
    const sdk = await assertWslSdkAvailable('Debian')
    expect(sdk.entryPath).toContain('/dist/index.js')

    mocks.runWslDistroAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    await expect(assertWslSdkAvailable('Debian', { refresh: true })).rejects.toThrow(
      'WSL 发行版内未检测到 pi-coding-agent',
    )
  })
})
