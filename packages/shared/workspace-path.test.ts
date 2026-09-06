import { describe, expect, it } from 'vitest'
import { workspacePathKey, workspacePathsEqual } from './workspace-path'

describe('workspace identity', () => {
  it('normalizes Windows drive, separators and trailing slash', () => {
    expect(workspacePathsEqual('d:\\REPO\\feature\\', 'D:/repo/feature')).toBe(true)
    expect(workspacePathsEqual('D:/repo/feature', 'D:/repo/main')).toBe(false)
  })
  it('preserves Linux and WSL directory case while normalizing WSL host aliases', () => {
    expect(workspacePathsEqual('/repo/A', '/repo/a')).toBe(false)
    expect(workspacePathsEqual('\\\\wsl$\\Ubuntu\\home\\User\\Repo', '//wsl.localhost/ubuntu/home/User/Repo/')).toBe(true)
    expect(workspacePathsEqual('//wsl$/Ubuntu/home/User', '//wsl$/Ubuntu/home/user')).toBe(false)
    expect(workspacePathKey('/')).toBe('/')
    expect(workspacePathsEqual(null, null)).toBe(false)
  })
})
