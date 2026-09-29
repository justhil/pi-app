import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslDistroAsync: vi.fn(),
  wslHomeDirSync: vi.fn(() => '/root'),
  wslDefaultShellSync: vi.fn(() => 'bash'),
  wslPathToWindows: vi.fn((distro: string, path: string) =>
    `\\\\wsl.localhost\\${distro}${path.replace(/\//g, '\\')}`,
  ),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '{"version":"0.83.0"}'),
  resolvePackageEntryPath: vi.fn((uncRoot: string) => `${uncRoot}\\dist\\index.js`),
}))

vi.mock('@shared/wsl-path', () => ({
  wslPathToWindows: mocks.wslPathToWindows,
}))

vi.mock('fs', () => ({
  default: {
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
    readFileSync: mocks.readFileSync,
  },
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
  readFileSync: mocks.readFileSync,
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslDistroAsync: mocks.runWslDistroAsync,
  wslHomeDir: vi.fn(async () => '/root'),
  wslHomeDirSync: mocks.wslHomeDirSync,
  wslDefaultShellSync: mocks.wslDefaultShellSync,
}))

const envMocks = vi.hoisted(() => ({
  resolveWslEnv: vi.fn(async () => null as null | { path: string }),
  store: {} as Record<string, unknown>,
}))
vi.mock('../wsl/wsl-env', () => ({
  resolveWslEnv: envMocks.resolveWslEnv,
  readWslPersisted: (key: string) => envMocks.store[key],
  writeWslPersisted: (key: string, value: unknown) => {
    envMocks.store[key] = value
  },
}))

vi.mock('../global-sdk-resolve', () => ({
  resolvePackageEntryPath: mocks.resolvePackageEntryPath,
}))

import { resolveWslActiveSdk, assertWslSdkAvailable, invalidateWslSdkResolveCache } from '../wsl/sdk-resolve'

beforeEach(() => {
  mocks.runWslDistroAsync.mockReset()
  mocks.wslPathToWindows.mockClear()
  mocks.mkdirSync.mockReset()
  mocks.writeFileSync.mockReset()
  mocks.readFileSync.mockReset().mockReturnValue('{"version":"0.83.0"}')
  mocks.resolvePackageEntryPath.mockReset()
  invalidateWslSdkResolveCache()
  envMocks.resolveWslEnv.mockReset().mockResolvedValue(null)
  envMocks.store = {}
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

  it('probes with the login-shell PATH so npm/pi match the node that runs the worker', async () => {
    envMocks.resolveWslEnv.mockResolvedValue({ path: '/home/u/.nvm/bin:/usr/bin' })
    mocks.runWslDistroAsync.mockResolvedValue({ status: 0, stdout: '', stderr: '' })
    await resolveWslActiveSdk('Debian')
    expect(mocks.runWslDistroAsync.mock.calls[0][1]).toEqual(['env', 'PATH=/home/u/.nvm/bin:/usr/bin', 'sh', '/root/.pi-desktop/probe.sh'])
  })

  it('serves a persisted install immediately and revalidates it in the background once stale', async () => {
    const stale = { packageRoot: '/old', entryPath: '/old/dist/index.js', version: '0.80.0' }
    envMocks.store.wslSdkCache = { Debian: { at: Date.now() - 120_000, value: stale } }
    let finishProbe!: (v: unknown) => void
    mocks.runWslDistroAsync.mockReturnValue(new Promise((resolve) => (finishProbe = resolve)))
    expect(await resolveWslActiveSdk('Debian')).toEqual(stale)
    await vi.waitFor(() => expect(mocks.runWslDistroAsync).toHaveBeenCalledTimes(1))
    finishProbe({ status: 0, stdout: '/root/new/node_modules/@earendil-works/pi-coding-agent\n', stderr: '' })
    await vi.waitFor(() => expect((envMocks.store.wslSdkCache as Record<string, { value: { packageRoot: string } }>).Debian.value.packageRoot).toBe('/root/new/node_modules/@earendil-works/pi-coding-agent'))
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
