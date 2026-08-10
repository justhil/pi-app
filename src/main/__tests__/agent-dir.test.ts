import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgentRuntimeConfig: vi.fn<() => { mode: 'host' | 'wsl'; distro: string | null }>(),
  wslHomeDirSync: vi.fn<(distro: string) => string | null>(),
}))

vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: mocks.getAgentRuntimeConfig,
  isWslRuntimeActive: () => mocks.getAgentRuntimeConfig().mode === 'wsl',
  setAgentRuntimeMode: vi.fn(),
}))

vi.mock('../wsl/wsl-exec', () => ({
  wslHomeDirSync: mocks.wslHomeDirSync,
}))

import { resolveActiveAgentDir, resolveActiveDesktopDir, resolveActiveHomeDir } from '../agent-dir'

describe('resolveActiveAgentDir', () => {
  it('stays on ~/.pi/agent in host mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    expect(resolveActiveAgentDir()).toMatch(/\.pi[\\/]agent$/)
  })

  it('respects PI_CODING_AGENT_DIR in host mode like the SDK', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = '/custom/agent-dir'
    try {
      expect(resolveActiveAgentDir()).toBe('/custom/agent-dir')
    } finally {
      if (previous == null) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous
    }
  })

  it('expands a leading tilde in PI_CODING_AGENT_DIR', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    const previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = '~/my-agent'
    try {
      expect(resolveActiveAgentDir()).toMatch(/my-agent$/)
      expect(resolveActiveAgentDir()).not.toContain('~')
    } finally {
      if (previous == null) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous
    }
  })

  it('points at the distro over UNC in WSL mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    mocks.wslHomeDirSync.mockReturnValue('/home/pi')
    expect(resolveActiveAgentDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\agent')
  })

  it('translates /mnt mounts to a Windows drive path in WSL mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    mocks.wslHomeDirSync.mockReturnValue('/mnt/c/Users/pi')
    expect(resolveActiveAgentDir()).toBe('C:\\Users\\pi\\.pi\\agent')
  })

  it('falls back to host when the distro home cannot be resolved', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    mocks.wslHomeDirSync.mockReturnValue(null)
    expect(resolveActiveAgentDir()).toMatch(/\.pi[\\/]agent$/)
  })

  it('falls back to host when no distro is configured', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: null })
    expect(resolveActiveAgentDir()).toMatch(/\.pi[\\/]agent$/)
  })
})

describe('resolveActiveDesktopDir', () => {
  it('stays on ~/.pi/desktop in host mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    expect(resolveActiveDesktopDir()).toMatch(/\.pi[\\/]desktop$/)
  })

  it('points at the distro desktop dir over UNC in WSL mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    mocks.wslHomeDirSync.mockReturnValue('/home/pi')
    expect(resolveActiveDesktopDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop')
  })
})

describe('resolveActiveHomeDir', () => {
  it('returns the host home in host mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    expect(resolveActiveHomeDir()).not.toMatch(/\.pi[\\/]/)
  })

  it('returns the distro home over UNC in WSL mode', () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    mocks.wslHomeDirSync.mockReturnValue('/home/pi')
    expect(resolveActiveHomeDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi')
  })
})
