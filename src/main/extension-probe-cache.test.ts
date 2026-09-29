import { beforeEach, describe, expect, it, vi } from 'vitest'

const previewProbe = vi.hoisted(() => vi.fn())
const mainProbe = vi.hoisted(() => vi.fn())

vi.mock('./session-preview-process', () => ({ sessionPreviewProcess: { probeExtensions: previewProbe } }))
vi.mock('./wsl/runtime-config', () => ({ isWslRuntimeActive: () => false }))
vi.mock('../extension-compat/extension-probe', () => ({ probeExtensions: mainProbe }))
vi.mock('../extension-compat/active-dirs', () => ({
  getActiveAgentDir: () => '/nonexistent/agent',
  getActiveDesktopDir: () => '/nonexistent/desktop',
  getActiveHomeDir: () => '/nonexistent/home',
}))

import { invalidateExtensionProbeCache, probeExtensionsShared } from './extension-probe-cache'

const probe = (name: string) => [{ id: name, name, registeredTools: [], registeredCommands: [] }]

beforeEach(() => {
  invalidateExtensionProbeCache()
  previewProbe.mockReset()
  mainProbe.mockReset()
})

describe('probeExtensionsShared', () => {
  it('probes off the main thread once for concurrent callers and serves copies from the cache', async () => {
    previewProbe.mockResolvedValue(probe('a'))
    const [first, second] = await Promise.all([probeExtensionsShared('/p'), probeExtensionsShared('/p')])
    expect(previewProbe).toHaveBeenCalledTimes(1)
    expect(previewProbe.mock.calls[0][0]).toMatchObject({ cwd: '/p', agentDir: '/nonexistent/agent' })
    expect(mainProbe).not.toHaveBeenCalled()

    // Callers decorate probes in place — that must not leak into the cache.
    ;(first[0] as { name: string }).name = 'mutated'
    expect(second[0].name).toBe('a')
    expect((await probeExtensionsShared('/p'))[0].name).toBe('a')
    expect(previewProbe).toHaveBeenCalledTimes(1)
  })

  it('re-probes for fresh reads, other projects and after invalidation', async () => {
    previewProbe.mockResolvedValue(probe('a'))
    await probeExtensionsShared('/p')
    await probeExtensionsShared('/p', { fresh: true })
    await probeExtensionsShared('/other')
    invalidateExtensionProbeCache()
    await probeExtensionsShared('/other')
    expect(previewProbe).toHaveBeenCalledTimes(4)
  })

  it('falls back to probing in-process when the preview process fails', async () => {
    previewProbe.mockRejectedValue(new Error('preview down'))
    mainProbe.mockReturnValue(probe('fallback'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await probeExtensionsShared('/p'))[0].name).toBe('fallback')
    expect(mainProbe).toHaveBeenCalledWith('/p')
    warn.mockRestore()
  })
})
