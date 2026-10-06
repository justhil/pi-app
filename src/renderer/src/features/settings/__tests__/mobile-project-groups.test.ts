import { describe, expect, it } from 'vitest'
import { projectGroups, shortenHome } from '../mobile-project-groups'

describe('projectGroups', () => {
  it('groups by parent folder, biggest first, names sorted', () => {
    const groups = projectGroups(['/home/me/workspace/pi-search', '/home/me/workspace/pi-app', '/tmp/demo', '/home/me/workspace/blog/'])
    expect(groups.map((g) => g.label)).toEqual(['~/workspace', '/tmp'])
    expect(groups[0].projects.map((p) => p.name)).toEqual(['blog', 'pi-app', 'pi-search'])
    expect(groups[0].projects[1].path).toBe('/home/me/workspace/pi-app')
  })

  it('puts temporary chats in their own group, by title, last', () => {
    const box = '/home/me/.config/pi-desktop/sandbox-workspaces/02c9a317'
    const groups = projectGroups(['/home/me/workspace/a', box], { [box]: { temporary: true, label: '看下报错' } }, '临时对话')
    expect(groups.map((g) => g.label)).toEqual(['~/workspace', '临时对话'])
    expect(groups[1]).toMatchObject({ temporary: true, projects: [{ path: box, name: '看下报错' }] })
  })

  it('shortens home on every platform', () => {
    expect(shortenHome('/home/me/workspace')).toBe('~/workspace')
    expect(shortenHome('/Users/me/code')).toBe('~/code')
    expect(shortenHome('C:\\Users\\me\\code')).toBe('~\\code')
    expect(projectGroups(['C:\\Users\\me\\code\\app'])[0].label).toBe('~\\code')
  })
})
