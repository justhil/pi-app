import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  listWslDistros: vi.fn(),
  probeWslDistro: vi.fn(),
}))

vi.mock('./registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../wsl/detection', () => ({
  listWslDistros: mocks.listWslDistros,
  probeWslDistro: mocks.probeWslDistro,
}))

import { registerWslHandlers } from './handlers/wsl'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.listWslDistros.mockReset()
  mocks.probeWslDistro.mockReset()
  registerWslHandlers()
})

describe('WSL IPC handlers', () => {
  it('should_await_async_distro_listing_without_blocking_main', async () => {
    let resolveList!: (value: Array<{ name: string; isDefault: boolean }>) => void
    mocks.listWslDistros.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )

    const pending = mocks.handlers.get('ipc:wsl.listDistros')!({})
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveList([{ name: 'Debian', isDefault: true }])
    await expect(pending).resolves.toEqual({ distros: [{ name: 'Debian', isDefault: true }] })
  })

  it('should_await_async_distro_probe_without_blocking_main', async () => {
    mocks.probeWslDistro.mockResolvedValue({ ok: true, distro: 'Debian' })

    await expect(
      mocks.handlers.get('ipc:wsl.probeDistro')!({ distro: 'Debian' }),
    ).resolves.toEqual({ result: { ok: true, distro: 'Debian' } })
  })
})
