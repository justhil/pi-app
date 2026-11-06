import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MODEL_CONNECT_TIMEOUT_MS,
  resetHttpConnectTimeoutForTest,
  resolveHttpConnectTimeoutMs,
  widenHttpConnectTimeout,
} from './worker-http-connect'

let root: string

/** A fake SDK whose own undici records the dispatcher it is given. */
function fakeSdk(): string {
  const pkg = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
  mkdirSync(join(pkg, 'dist'), { recursive: true })
  const entry = join(pkg, 'dist', 'index.js')
  writeFileSync(entry, '')
  const undici = join(pkg, 'node_modules', 'undici')
  mkdirSync(undici, { recursive: true })
  writeFileSync(join(undici, 'package.json'), JSON.stringify({ name: 'undici', main: 'index.js' }))
  writeFileSync(join(undici, 'index.js'), `
    class Agent { constructor(options) { this.options = options } }
    module.exports = { Agent, setGlobalDispatcher(d) { globalThis.__fakeDispatcher = d } }
  `)
  return entry
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-http-connect-'))
  resetHttpConnectTimeoutForTest()
  delete (globalThis as { __fakeDispatcher?: unknown }).__fakeDispatcher
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  resetHttpConnectTimeoutForTest()
  delete (globalThis as { __fakeDispatcher?: unknown }).__fakeDispatcher
})

describe('worker HTTP connect timeout', () => {
  it('should_install_a_30s_connect_timeout_from_the_sdks_own_undici', () => {
    expect(widenHttpConnectTimeout(fakeSdk())).toBe(true)
    const d = (globalThis as { __fakeDispatcher?: { options: unknown } }).__fakeDispatcher
    expect(d?.options).toEqual({ connect: { timeout: 30_000 } })
    expect(MODEL_CONNECT_TIMEOUT_MS).toBe(30_000)
  })

  it('should_install_only_once_when_timeout_is_unchanged_and_update_when_changed', () => {
    const entry = fakeSdk()
    widenHttpConnectTimeout(entry, 30_000)
    const first = (globalThis as { __fakeDispatcher?: unknown }).__fakeDispatcher
    widenHttpConnectTimeout(entry, 30_000)
    expect((globalThis as { __fakeDispatcher?: unknown }).__fakeDispatcher).toBe(first)

    widenHttpConnectTimeout(entry, 45_000)
    const second = (globalThis as { __fakeDispatcher?: { options: unknown } }).__fakeDispatcher
    expect(second).not.toBe(first)
    expect(second?.options).toEqual({ connect: { timeout: 45_000 } })
    expect(resolveHttpConnectTimeoutMs(0)).toBe(30_000)
    expect(resolveHttpConnectTimeoutMs(undefined)).toBe(30_000)
  })

  it('should_leave_the_session_running_when_the_sdk_has_no_undici', () => {
    expect(widenHttpConnectTimeout(join(root, 'nowhere', 'index.js'))).toBe(false)
    expect((globalThis as { __fakeDispatcher?: unknown }).__fakeDispatcher).toBeUndefined()
  })

  it('should_resolve_undici_from_the_bundled_sdk_entry', () => {
    const entry = resolve('node_modules/@earendil-works/pi-coding-agent/dist/index.js')
    const undici = createRequire(entry)('undici') as { Agent: unknown; setGlobalDispatcher: unknown }
    expect(typeof undici.Agent).toBe('function')
    expect(typeof undici.setGlobalDispatcher).toBe('function')
  })
})
