import { describe, expect, it } from 'vitest'
import { projectDisplayNameKey, resolveProjectDisplayName, workspacePathKey, workspacePathsEqual } from './workspace-path'

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
  it('resolves custom project and repository group display names across slash styles', () => {
    const names = {
      [projectDisplayNameKey('E:\\myproject\\pi-app')]: '主线目录',
      [projectDisplayNameKey('E:/myproject/pi-app', true)]: 'Pi 桌面应用',
    }
    expect(resolveProjectDisplayName(names, 'E:/myproject/pi-app', 'pi-app', { isRepositoryGroup: true })).toBe('Pi 桌面应用')
    expect(resolveProjectDisplayName(names, 'E:/myproject/pi-app', '主目录', { grouped: true })).toBe('主线目录')
    expect(resolveProjectDisplayName(names, 'E:/myproject/other', 'other', { grouped: true })).toBe('other')
  })
})
