import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  userDataDir: '',
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.userDataDir) },
}))

vi.mock('child_process', () => ({
  default: {
    execFileSync: vi.fn(),
    spawn: mocks.spawn,
    spawnSync: vi.fn(() => ({ status: 0, stdout: '10.0.0' })),
  },
  execFileSync: vi.fn(),
  spawn: mocks.spawn,
  spawnSync: vi.fn(() => ({ status: 0, stdout: '10.0.0' })),
}))

vi.mock('./wsl/sdk-resolve', () => ({
  resolveWslActiveSdk: vi.fn(),
  assertWslSdkAvailable: vi.fn(),
  invalidateWslSdkResolveCache: vi.fn(),
}))

vi.mock('./wsl/wsl-exec', () => ({
  invalidateWslEnvCaches: vi.fn(),
}))

vi.mock('./wsl/runtime-config', () => ({
  getAgentRuntimeConfig: vi.fn(() => ({ mode: 'host' })),
}))

import {
  finalizeVersionInstall,
  installVersion,
  switchTo,
} from './sdk-manager'
import { readSdkSelection, resolveActiveSdk } from './sdk-loader'
import { confirmSdkSelection } from './sdk-selection-transaction'

function writeFakeSdk(installDir: string, marker: string): void {
  const packageRoot = join(
    installDir,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
  )
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(installDir, 'package.json'), '{}', 'utf8')
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@earendil-works/pi-coding-agent',
      version: marker,
      type: 'module',
      exports: './index.js',
    }),
    'utf8',
  )
  writeFileSync(
    join(packageRoot, 'index.js'),
    `export const marker = ${JSON.stringify(marker)}`,
    'utf8',
  )
}

function spawnResult(code: number, prepare?: (cwd: string) => void) {
  return (_command: string, _args: string[], options: { cwd: string }) => {
    prepare?.(options.cwd)
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'close') queueMicrotask(() => listener(code))
      }),
    }
  }
}

function installedSdkDir(userDir: string): string {
  return join(mocks.userDataDir, 'sdk', userDir)
}

async function installAndConfirm(
  version: string,
  verifySelection: (target: 'builtin' | 'global' | 'user') => Promise<{
    kind: 'builtin' | 'global' | 'user'
    version: string
  }>,
) {
  const previousSelection = readSdkSelection(mocks.userDataDir)
  const installed = await installVersion(version, vi.fn())
  try {
    const active = await confirmSdkSelection({
      target: 'user',
      rollbackTarget: previousSelection,
      restartWorker: async () => {},
      verifySelection,
      rollbackSelection: switchTo,
    })
    finalizeVersionInstall(installed.userDir, true)
    return active
  } catch (error) {
    finalizeVersionInstall(installed.userDir, false)
    throw error
  }
}

describe('user SDK runtime upgrades', () => {
  beforeEach(() => {
    mocks.userDataDir = mkdtempSync(join(tmpdir(), 'pi-sdk-generation-'))
    mocks.spawn.mockReset()
  })

  it('rejects an unsafe userDir pointer instead of escaping the SDK directory', () => {
    const sdkDir = join(mocks.userDataDir, 'sdk')
    mkdirSync(sdkDir, { recursive: true })
    writeFileSync(
      join(sdkDir, 'current.json'),
      JSON.stringify({
        active: 'user',
        userDir: '..',
      }),
      'utf8',
    )

    expect(resolveActiveSdk(mocks.userDataDir)).toMatchObject({
      kind: 'builtin',
    })
  })

  it('installs upgrades into a new path so the second load sees new module code', async () => {
    let installCount = 0
    mocks.spawn.mockImplementation(
      spawnResult(0, (cwd) => {
        installCount += 1
        writeFakeSdk(cwd, `generation-${installCount}`)
      }),
    )

    await installVersion('1.0.0', vi.fn())
    const first = resolveActiveSdk(mocks.userDataDir)
    const firstModule = await import(first.entryPath)

    await installVersion('2.0.0', vi.fn())
    const second = resolveActiveSdk(mocks.userDataDir)
    const secondModule = await import(second.entryPath)

    expect(first.entryPath).not.toBe(second.entryPath)
    expect(firstModule.marker).toBe('generation-1')
    expect(secondModule.marker).toBe('generation-2')
    expect(first.entryPath).not.toContain('?')
    expect(second.entryPath).not.toContain('?')
    expect(
      JSON.parse(
        readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8'),
      ),
    ).toEqual({
      active: 'user',
      userDir: expect.any(String),
    })
  })

  it('restores the exact previous user generation when runtime validation fails', async () => {
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => writeFakeSdk(cwd, 'stable')),
    )
    await installAndConfirm('1.0.0', async () => ({ kind: 'user', version: 'stable' }))
    const previousSelection = readSdkSelection(mocks.userDataDir)
    expect(previousSelection).toMatchObject({ kind: 'user', userDir: expect.any(String) })
    if (previousSelection.kind !== 'user' || !previousSelection.userDir) throw new Error('missing previous generation')
    const previousUserDir = previousSelection.userDir
    const currentBefore = readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8')
    writeFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), JSON.stringify({ active: 'builtin' }), 'utf8')
    await switchTo(previousSelection)
    expect(readSdkSelection(mocks.userDataDir)).toEqual(previousSelection)
    expect(readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8')).toBe(currentBefore)

    let failedUserDir = ''
    let validatedWithBothGenerations = false
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => {
        failedUserDir = cwd.split(/[\\/]/).at(-1) || ''
        writeFakeSdk(cwd, 'broken')
      }),
    )
    const verifySelection = vi
      .fn()
      .mockImplementationOnce(async () => {
        validatedWithBothGenerations =
          existsSync(installedSdkDir(previousUserDir)) &&
          existsSync(installedSdkDir(failedUserDir))
        throw new Error('Worker validation failed')
      })
      .mockImplementationOnce(async () => {
        const active = resolveActiveSdk(mocks.userDataDir)
        return { kind: active.kind, version: active.version }
      })

    await expect(installAndConfirm('2.0.0', verifySelection)).rejects.toThrow(
      '目标失败: Worker validation failed；已回滚到 user',
    )

    expect(validatedWithBothGenerations).toBe(true)
    expect(readSdkSelection(mocks.userDataDir)).toEqual(previousSelection)
    expect(readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8')).toBe(currentBefore)
    expect(existsSync(installedSdkDir(previousUserDir))).toBe(true)
    expect(existsSync(installedSdkDir(failedUserDir))).toBe(false)
  })

  it('cleans the previous user generation only after runtime validation succeeds', async () => {
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => writeFakeSdk(cwd, 'stable')),
    )
    await installAndConfirm('1.0.0', async () => ({ kind: 'user', version: 'stable' }))
    const previousSelection = readSdkSelection(mocks.userDataDir)
    expect(previousSelection).toMatchObject({ kind: 'user', userDir: expect.any(String) })
    if (previousSelection.kind !== 'user' || !previousSelection.userDir) throw new Error('missing previous generation')
    const previousUserDir = previousSelection.userDir

    let nextUserDir = ''
    let validatedWithBothGenerations = false
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => {
        nextUserDir = cwd.split(/[\\/]/).at(-1) || ''
        writeFakeSdk(cwd, 'next')
      }),
    )

    await expect(
      installAndConfirm('2.0.0', async () => {
        validatedWithBothGenerations =
          existsSync(installedSdkDir(previousUserDir)) &&
          existsSync(installedSdkDir(nextUserDir))
        return { kind: 'user', version: 'next' }
      }),
    ).resolves.toEqual({ kind: 'user', version: 'next' })

    expect(validatedWithBothGenerations).toBe(true)
    expect(existsSync(installedSdkDir(previousUserDir))).toBe(false)
    expect(existsSync(installedSdkDir(nextUserDir))).toBe(true)
    expect(readSdkSelection(mocks.userDataDir)).toEqual({ kind: 'user', userDir: nextUserDir })
  })

  it('keeps the previous active SDK when an upgrade fails', async () => {
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => writeFakeSdk(cwd, 'stable')),
    )
    await installVersion('1.0.0', vi.fn())
    const activeBefore = resolveActiveSdk(mocks.userDataDir)
    const currentBefore = readFileSync(
      join(mocks.userDataDir, 'sdk', 'current.json'),
      'utf8',
    )

    mocks.spawn.mockImplementationOnce(spawnResult(1))

    await expect(installVersion('2.0.0', vi.fn())).rejects.toThrow(
      'npm 退出码 1',
    )
    expect(resolveActiveSdk(mocks.userDataDir).entryPath).toBe(
      activeBefore.entryPath,
    )
    expect(
      readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8'),
    ).toBe(currentBefore)
  })

  it('keeps the previous active SDK when npm cannot start', async () => {
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => writeFakeSdk(cwd, 'stable')),
    )
    await installVersion('1.0.0', vi.fn())
    const activeBefore = resolveActiveSdk(mocks.userDataDir)
    const currentBefore = readFileSync(
      join(mocks.userDataDir, 'sdk', 'current.json'),
      'utf8',
    )

    mocks.spawn.mockImplementationOnce(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'error')
          queueMicrotask(() => listener(new Error('spawn failed')))
      }),
    }))

    await expect(installVersion('2.0.0', vi.fn())).rejects.toThrow(
      'npm 启动失败: spawn failed',
    )
    expect(resolveActiveSdk(mocks.userDataDir).entryPath).toBe(
      activeBefore.entryPath,
    )
    expect(
      readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8'),
    ).toBe(currentBefore)
  })

  it('keeps the previous active SDK when spawning npm throws synchronously', async () => {
    mocks.spawn.mockImplementationOnce(
      spawnResult(0, (cwd) => writeFakeSdk(cwd, 'stable')),
    )
    await installVersion('1.0.0', vi.fn())
    const activeBefore = resolveActiveSdk(mocks.userDataDir)
    const currentBefore = readFileSync(
      join(mocks.userDataDir, 'sdk', 'current.json'),
      'utf8',
    )

    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('sync spawn failed')
    })

    await expect(installVersion('2.0.0', vi.fn())).rejects.toThrow(
      'npm 启动失败: sync spawn failed',
    )
    expect(resolveActiveSdk(mocks.userDataDir).entryPath).toBe(
      activeBefore.entryPath,
    )
    expect(
      readFileSync(join(mocks.userDataDir, 'sdk', 'current.json'), 'utf8'),
    ).toBe(currentBefore)
  })
})
