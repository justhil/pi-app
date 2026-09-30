import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gate: null as Promise<void> | null, getActiveAgentDir: vi.fn(() => '/agent'), probe: vi.fn(async () => []) }))
vi.mock('fs/promises', () => {
  const fs = { stat: async () => ({ mtimeMs: 1 }) }
  return { ...fs, default: fs }
})
vi.mock('../extension-compat/active-dirs', () => ({ getActiveAgentDir: mocks.getActiveAgentDir, getActiveDesktopDir: () => '/desktop', getActiveHomeDir: () => '/home' }))
vi.mock('../extension-compat/extension-probe', () => ({ probeExtensions: vi.fn(() => []) }))
vi.mock('./session-preview-process', () => ({ sessionPreviewProcess: { probeExtensions: mocks.probe } }))
vi.mock('./wsl/wsl-env', () => ({ awaitWslVm: () => mocks.gate ?? Promise.resolve() }))
import { probeExtensionsShared } from './extension-probe-cache'

describe('extension probe startup', () => {
  it('should_wait_for_environment_when_wsl_directory_lookup_is_not_ready', async () => {
    let ready!: () => void
    mocks.gate = new Promise<void>((resolve) => { ready = resolve })
    const probe = probeExtensionsShared('/project')
    await Promise.resolve()
    const early = mocks.getActiveAgentDir.mock.calls.length
    ready()
    await probe
    expect(early).toBe(0)
    expect(mocks.probe).toHaveBeenCalledOnce()
  })
})
