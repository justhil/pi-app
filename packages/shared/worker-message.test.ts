import { describe, expect, it } from 'vitest'
import { normalizeUserMessageDisplayText } from './worker-message'

const expandedSkill = (args = '', name = 'demo-skill') => `<skill name="${name}" location="C:\\skills\\demo-skill\\SKILL.md">
References are relative to C:\\skills\\demo-skill.

# Demo

Secret skill body.
</skill>${args ? `\n\n${args}` : ''}`

describe('normalizeUserMessageDisplayText', () => {
  it('collapses complete SDK skill blocks to the literal command', () => {
    expect(normalizeUserMessageDisplayText(expandedSkill())).toBe('/skill:demo-skill')
    expect(normalizeUserMessageDisplayText(expandedSkill('explain this'))).toBe(
      '/skill:demo-skill explain this',
    )
    expect(normalizeUserMessageDisplayText(expandedSkill('first\nsecond'))).toBe(
      '/skill:demo-skill first\nsecond',
    )
    expect(normalizeUserMessageDisplayText(expandedSkill('explain this', 'Demo_Skill'))).toBe(
      '/skill:Demo_Skill explain this',
    )
  })

  it('preserves user arguments containing a literal closing tag', () => {
    expect(normalizeUserMessageDisplayText(expandedSkill('arg one\n</skill>'))).toBe(
      '/skill:demo-skill arg one\n</skill>',
    )
  })

  it('passes through a wrapper ending with only the argument separator', () => {
    const text = `${expandedSkill()}\n\n`

    expect(normalizeUserMessageDisplayText(text)).toBe(text)
  })

  it('uses the last wrapper close when the skill body contains a literal closing tag', () => {
    const text = `<skill name="demo-skill" location="C:\\skills\\demo-skill\\SKILL.md">
References are relative to C:\\skills\\demo-skill.

The body quotes this literal sequence:
</skill>
and continues without leaking it as user arguments.
</skill>

actual arg`

    expect(normalizeUserMessageDisplayText(text)).toBe('/skill:demo-skill actual arg')
  })

  it.each([
    'ordinary text',
    '/skill:not-installed x',
    '<skill name="demo-skill" location="x">partial',
    `${expandedSkill()} suffix`,
    `prefix ${expandedSkill()}`,
    expandedSkill().replaceAll('\n', '\r\n'),
  ])('passes through unrecognized text: %s', (text) => {
    expect(normalizeUserMessageDisplayText(text)).toBe(text)
  })
})
