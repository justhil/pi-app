import { describe, expect, it } from 'vitest'
import { buildWorkerSkillCatalog } from './skill-catalog-runtime'

describe('worker skill catalog', () => {
  it('should_keep_loser_shadowed_when_the_original_winner_is_disabled', () => {
    const catalog = buildWorkerSkillCatalog({
      runtimeId: 'host',
      currentSkills: [],
      baseSkills: [
        {
          name: 'review',
          description: 'Winner',
          filePath: '/user/review/SKILL.md',
          baseDir: '/user/review',
          sourceInfo: { path: '/user/review/SKILL.md', source: 'local', scope: 'user', origin: 'top-level' },
        },
      ],
      diagnostics: [
        {
          type: 'collision',
          message: 'collision',
          collision: {
            resourceType: 'skill',
            name: 'review',
            winnerPath: '/user/review/SKILL.md',
            loserPath: '/project/review/SKILL.md',
          },
        },
      ],
      overrides: { 'path:/user/review/SKILL.md': false },
      loadSkill: (path) => ({
        name: 'review',
        description: path.includes('project') ? 'Loser' : 'Winner',
        filePath: path,
        baseDir: path.replace('/SKILL.md', ''),
        sourceInfo: {
          path,
          source: 'local',
          scope: path.includes('project') ? 'project' : 'user',
          origin: 'top-level',
        },
      }),
    })

    expect(catalog.complete).toBe(true)
    expect(catalog.effectiveSkills).toEqual([])
    expect(catalog.candidates).toEqual([
      expect.objectContaining({ filePath: '/user/review/SKILL.md', enabled: false, effective: false, shadowed: false }),
      expect.objectContaining({ filePath: '/project/review/SKILL.md', enabled: true, effective: false, shadowed: true }),
    ])
  })

  it('should_authorize_only_a_catalog_key_not_an_arbitrary_path', () => {
    const catalog = buildWorkerSkillCatalog({
      runtimeId: 'host',
      currentSkills: [],
      baseSkills: [],
      diagnostics: [],
      overrides: {},
      loadSkill: () => null,
    })

    expect(catalog.candidates.find((row) => row.key === 'C:/Windows/System32/drivers/etc/hosts')).toBeUndefined()
  })
})
