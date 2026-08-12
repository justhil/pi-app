import { describe, expect, it } from 'vitest'
import { resolveSkillContextActivity } from './skill-context-activity'

describe('resolveSkillContextActivity', () => {
  it('projects a native read of SKILL.md as Skill context', () => {
    expect(resolveSkillContextActivity('read', {
      path: 'C:\\Users\\dev\\.pi\\agent\\skills\\frontend-taste\\SKILL.md',
    })).toEqual({
      name: 'frontend-taste',
      path: 'C:\\Users\\dev\\.pi\\agent\\skills\\frontend-taste\\SKILL.md',
    })
  })

  it('supports the normalized read detail used by history rows', () => {
    expect(resolveSkillContextActivity('read', undefined, {
      type: 'read',
      path: '/home/dev/.pi/agent/skills/tdd-fix/SKILL.md',
    })).toEqual({
      name: 'tdd-fix',
      path: '/home/dev/.pi/agent/skills/tdd-fix/SKILL.md',
    })
  })

  it('leaves ordinary reads and non-read tools unchanged', () => {
    expect(resolveSkillContextActivity('read', { path: '/repo/README.md' })).toBeNull()
    expect(resolveSkillContextActivity('write', { path: '/repo/skill/SKILL.md' })).toBeNull()
  })
})
