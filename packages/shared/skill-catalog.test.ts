import { describe, expect, it } from 'vitest'
import { filterSkillsByEnabledPaths, skillCatalogKey } from './skill-catalog'

describe('skill catalog filtering', () => {
  it('filters only by canonical filePath and does not promote another name winner', () => {
    const skills = [
      { name: 'demo', filePath: 'C:/user/skills/demo/SKILL.md' },
      { name: 'other', filePath: 'C:/proj/.pi/skills/other/SKILL.md' },
    ]
    const kept = filterSkillsByEnabledPaths(skills, {
      'path:C:/user/skills/demo/SKILL.md': false,
    })
    expect(kept.map((skill) => skill.name)).toEqual(['other'])
  })

  it('builds a stable identity key from runtime + path + source', () => {
    expect(
      skillCatalogKey({ runtimeId: 'host', filePath: 'C:\\a\\SKILL.md', source: 'user' }),
    ).toBe('host|C:/a/SKILL.md|user')
  })
})
