import { describe, expect, it } from 'vitest'
import { RECENT_PROJECTS_CAP, nextRecentProjects } from './recent-projects'

describe('nextRecentProjects', () => {
  describe('MRU mode (default, fixedOrder=false)', () => {
    it('moves an existing project to the front', () => {
      expect(nextRecentProjects(['a', 'b', 'c'], 'b', false)).toEqual(['b', 'a', 'c'])
    })

    it('puts a new project at the front', () => {
      expect(nextRecentProjects(['a', 'b'], 'c', false)).toEqual(['c', 'a', 'b'])
    })

    it('caps at the most recent 10', () => {
      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', false)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[0]).toBe('new')
      expect(next).not.toContain('p9')
    })
  })

  describe('fixed order (fixedOrder=true)', () => {
    it('keeps existing projects in place', () => {
      expect(nextRecentProjects(['a', 'b', 'c'], 'b', true)).toEqual(['a', 'b', 'c'])
      expect(nextRecentProjects(['a', 'b', 'c'], 'c', true)).toEqual(['a', 'b', 'c'])
    })

    it('appends a new project at the end', () => {
      expect(nextRecentProjects(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c'])
    })

    it('retains every project when adding beyond the MRU limit', () => {
      const full = Array.from({ length: RECENT_PROJECTS_CAP * 2 }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', true)
      expect(next).toEqual([...full, 'new'])
      expect(nextRecentProjects(next, 'p0', true)).toEqual(next)
    })
  })
})
