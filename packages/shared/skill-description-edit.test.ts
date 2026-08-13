import { describe, expect, it } from 'vitest'
import { replaceSkillDescription } from './skill-description-edit'

describe('replaceSkillDescription', () => {
  it('keeps BOM and CRLF for a simple scalar', () => {
    const raw = '\uFEFF---\r\nname: demo\r\ndescription: old\r\n---\r\n# Body\r\n'
    const next = replaceSkillDescription(raw, 'new desc')
    expect(next.ok).toBe(true)
    if (next.ok) {
      expect(next.content.startsWith('\uFEFF')).toBe(true)
      expect(next.content).toContain('\r\n')
      expect(next.content).toContain('description: "new desc"')
      expect(next.content).toContain('# Body')
    }
  })

  it('refuses complex YAML', () => {
    expect(replaceSkillDescription('---\ndescription: |\n  multi\n---\n', 'x').ok).toBe(false)
  })
})
