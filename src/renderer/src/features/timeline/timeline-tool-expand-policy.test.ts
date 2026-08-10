import { describe, expect, it } from 'vitest'
import { pickAutoExpandedActivityIds } from './timeline-tool-expand-policy'

function slot(id: string, kind: 'tool' | 'thinking' = 'tool') {
  return { id, kind }
}

describe('pickAutoExpandedActivityIds', () => {
  it('returns empty when maxExpanded is 0 (window disabled)', () => {
    const slots = Array.from({ length: 5 }, (_, i) => slot(`t${i}`))
    const ids = pickAutoExpandedActivityIds(slots, { maxExpanded: 0 })
    expect(ids.size).toBe(0)
  })

  it('returns empty on empty slots', () => {
    expect(pickAutoExpandedActivityIds([], { maxExpanded: 15 }).size).toBe(0)
  })

  it('keeps only the newest N activity rows (sliding window tail)', () => {
    const slots = Array.from({ length: 20 }, (_, i) => slot(`t${i}`))
    const ids = pickAutoExpandedActivityIds(slots, { maxExpanded: 15 })
    expect(ids.size).toBe(15)
    expect(ids.has('t19')).toBe(true)
    expect(ids.has('t4')).toBe(false)
    expect(ids.has('t0')).toBe(false)
  })

  it('counts thinking rows in the same window as tools', () => {
    const slots = [
      slot('think-1', 'thinking'),
      slot('tool-1', 'tool'),
      slot('think-2', 'thinking'),
      slot('tool-2', 'tool'),
    ]
    const ids = pickAutoExpandedActivityIds(slots, { maxExpanded: 2 })
    expect(ids.size).toBe(2)
    expect(ids.has('think-2')).toBe(true)
    expect(ids.has('tool-2')).toBe(true)
    expect(ids.has('think-1')).toBe(false)
    expect(ids.has('tool-1')).toBe(false)
  })

  it('window is static — not tied to agent running or run id', () => {
    const slots = [slot('a'), slot('b'), slot('c')]
    const ids = pickAutoExpandedActivityIds(slots, { maxExpanded: 2 })
    expect(ids.has('c')).toBe(true)
    expect(ids.has('b')).toBe(true)
    expect(ids.has('a')).toBe(false)
  })
})
