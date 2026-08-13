import { afterEach, describe, expect, it } from 'vitest'
import { applySkillsOverride, getSkillBaseSnapshot, resetSkillBaseSnapshot } from './skill-override'

afterEach(() => resetSkillBaseSnapshot())

describe('skill override base snapshot', () => {
  it('should_keep_pre_filter_winner_and_collision_when_winner_is_disabled', () => {
    const base = {
      skills: [{ name: 'review', filePath: '/user/review/SKILL.md' }],
      diagnostics: [
        {
          type: 'collision',
          collision: {
            resourceType: 'skill',
            name: 'review',
            winnerPath: '/user/review/SKILL.md',
            loserPath: '/project/review/SKILL.md',
          },
        },
      ],
    }

    applySkillsOverride(base)

    expect(getSkillBaseSnapshot()).toEqual(base)
  })
})
