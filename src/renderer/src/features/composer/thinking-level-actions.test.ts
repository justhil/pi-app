import { describe, expect, it } from 'vitest'
import { nextThinkingLevel } from './thinking-level-actions'

describe('nextThinkingLevel', () => {
  it('steps through supported levels and wraps', () => {
    const available = ['off', 'low', 'medium', 'high']
    expect(nextThinkingLevel('low', available)).toBe('medium')
    expect(nextThinkingLevel('high', available)).toBe('off')
  })

  it('treats an empty list as every level supported', () => {
    expect(nextThinkingLevel('xhigh', [])).toBe('max')
    expect(nextThinkingLevel(undefined, undefined)).toBe('minimal')
  })
})
