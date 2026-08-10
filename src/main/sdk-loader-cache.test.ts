import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const discoverMock = vi.fn<() => string | null>(() => null)

vi.mock('./global-sdk-resolve', () => ({
  discoverGlobalPiCodingAgentRoot: () => discoverMock(),
  resolvePackageEntryPath: vi.fn(() => null),
  validatePiCodingAgentRoot: vi.fn(() => false),
}))

import { clearGlobalSdkPathCache, resolveActiveSdk, resolveGlobalSdkPath } from './sdk-loader'

const temporaryDirectories: string[] = []

function makeUserDataDir(active: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-sdk-loader-'))
  temporaryDirectories.push(dir)
  mkdirSync(join(dir, 'sdk'), { recursive: true })
  writeFileSync(join(dir, 'sdk', 'current.json'), JSON.stringify({ active }), 'utf8')
  return dir
}

beforeEach(() => {
  clearGlobalSdkPathCache()
  discoverMock.mockClear()
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('resolveGlobalSdkPath failure caching', () => {
  it('should_cache_a_failed_discovery_and_not_rescan_per_call', () => {
    discoverMock.mockReturnValue(null)
    expect(resolveGlobalSdkPath()).toBeNull()
    expect(resolveGlobalSdkPath()).toBeNull()
    expect(discoverMock).toHaveBeenCalledTimes(1)
  })
})

describe('resolveActiveSdk caching', () => {
  it('should_resolve_global_discovery_once_while_the_sdk_config_is_unchanged', () => {
    const dir = makeUserDataDir('global')
    const first = resolveActiveSdk(dir)
    const second = resolveActiveSdk(dir)
    // global discovery fails -> builtin fallback, but discovery must not re-run
    expect(first.kind).toBe('builtin')
    expect(first.fallbackReason).toBe('global-unavailable')
    expect(second).toBe(first)
    expect(discoverMock).toHaveBeenCalledTimes(1)
  })

  it('should_recompute_when_the_sdk_config_mtime_changes', () => {
    const dir = makeUserDataDir('global')
    resolveActiveSdk(dir)
    // switch selection to builtin and bump mtime beyond fs timestamp granularity
    writeFileSync(join(dir, 'sdk', 'current.json'), JSON.stringify({ active: 'builtin' }), 'utf8')
    const future = new Date(Date.now() + 5_000)
    utimesSync(join(dir, 'sdk', 'current.json'), future, future)
    const next = resolveActiveSdk(dir)
    expect(next.kind).toBe('builtin')
    expect(next.fallbackReason).toBeUndefined()
  })
})
