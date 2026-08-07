import { describe, expect, it } from 'vitest'
import { isSkillInvocationMessage, parseSkillInvocationName } from './skill-invocation-row'

describe('skill invocation detection', () => {
  it('detects a skill-wrapped user message', () => {
    const text =
      '<skill name="batch-grill-with-docs" location="~/.agents/skills/batch-grill-with-docs/SKILL.md">\n# Batch Grill with Docs'
    expect(isSkillInvocationMessage(text)).toBe(true)
    expect(parseSkillInvocationName(text)).toBe('batch-grill-with-docs')
  })

  it('rejects ordinary user messages', () => {
    expect(isSkillInvocationMessage('hello world')).toBe(false)
    expect(isSkillInvocationMessage('')).toBe(false)
    expect(isSkillInvocationMessage('<skillz>not a skill</skillz>')).toBe(false)
  })

  it('tolerates leading whitespace', () => {
    expect(isSkillInvocationMessage('  <skill name="x" location="y">')).toBe(true)
  })
})
