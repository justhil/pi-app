import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mockUserData = 'C:\\Users\\T\\AppData\\Roaming\\pi-desktop'
let mockWslActive = false
let mockDesktopDir = 'C:\\Users\\T\\.pi\\desktop'

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData },
}))

vi.mock('../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => mockWslActive,
}))

vi.mock('../agent-dir', () => ({
  resolveActiveDesktopDir: () => mockDesktopDir,
}))

vi.mock('../config-store', () => ({
  configStore: { get: () => ({}), set: () => {}, getAll: () => ({}), getSkillOverrides: () => ({}) },
}))

import { getSandboxRoot, isSandboxWorkspacePath } from '../sandbox-workspaces'

afterEach(() => {
  mockWslActive = false
  mockDesktopDir = 'C:\\Users\\T\\.pi\\desktop'
})

describe('sandbox root switching (WSL runtime)', () => {
  it('stays under userData in host mode', () => {
    mockWslActive = false
    expect(getSandboxRoot()).toBe(join('C:\\Users\\T\\AppData\\Roaming\\pi-desktop', 'sandbox-workspaces'))
  })

  it('points into the WSL desktop dir in WSL mode', () => {
    mockWslActive = true
    mockDesktopDir = '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop'
    expect(getSandboxRoot()).toBe(join('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop', 'sandbox-workspaces'))
  })

  it('recognizes sandbox paths under the active WSL root', () => {
    mockWslActive = true
    mockDesktopDir = '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop'
    expect(
      isSandboxWorkspacePath(join('\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop\\sandbox-workspaces', '781ac8c3')),
    ).toBe(true)
    expect(isSandboxWorkspacePath('\\\\wsl.localhost\\Debian\\other\\proj')).toBe(false)
  })

  it('still recognizes legacy userData sandbox paths while WSL mode is active', () => {
    mockWslActive = true
    mockDesktopDir = '\\\\wsl.localhost\\Debian\\home\\pi\\.pi\\desktop'
    expect(
      isSandboxWorkspacePath('C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\old1'),
    ).toBe(true)
  })

  it('host mode only recognizes the userData root', () => {
    mockWslActive = false
    expect(
      isSandboxWorkspacePath('C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\abc'),
    ).toBe(true)
    expect(isSandboxWorkspacePath('C:\\Users\\T\\other\\sandbox-workspaces\\abc')).toBe(false)
  })
})
