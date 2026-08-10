import { describe, expect, it, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

import { getActiveAgentDir, getActiveDesktopDir, getActiveHomeDir, setActiveDirResolvers } from './active-dirs'

describe('active-dirs resolvers', () => {
  beforeEach(() => {
    setActiveDirResolvers({})
  })

  it('defaults to host homedir paths', () => {
    expect(getActiveAgentDir()).toBe(join(homedir(), '.pi', 'agent'))
    expect(getActiveDesktopDir()).toBe(join(homedir(), '.pi', 'desktop'))
    expect(getActiveHomeDir()).toBe(homedir())
  })

  it('overrides all resolvers for WSL mode', () => {
    setActiveDirResolvers({
      agentDir: () => '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\agent',
      desktopDir: () => '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop',
      homeDir: () => '\\\\wsl.localhost\\Debian\\home\\pi',
    })
    expect(getActiveAgentDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\agent')
    expect(getActiveDesktopDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop')
    expect(getActiveHomeDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi')
  })

  it('re-resolves dynamically (runtime switch reflects on next call)', () => {
    let mode = 'host'
    setActiveDirResolvers({
      agentDir: () =>
        mode === 'wsl' ? '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\agent' : 'C:\\Users\\hostuser\\.pi\\agent',
    })
    expect(getActiveAgentDir()).toBe('C:\\Users\\hostuser\\.pi\\agent')
    mode = 'wsl'
    expect(getActiveAgentDir()).toBe('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\agent')
  })
})
