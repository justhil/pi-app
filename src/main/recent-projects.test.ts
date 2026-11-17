import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RECENT_PROJECTS_CAP,
  nextRecentProjects,
  replaceRecentProjectInPlace,
  workspaceRealPathsEqual,
} from './recent-projects'

const tempRoots: string[] = []
afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('nextRecentProjects', () => {
  describe('MRU mode (default, fixedOrder=false)', () => {
    it('moves an existing project to the front', () => {
      expect(nextRecentProjects(['a', 'b', 'c'], 'b', false)).toEqual(['b', 'a', 'c'])
    })

    it('puts a new project at the front', () => {
      expect(nextRecentProjects(['a', 'b'], 'c', false)).toEqual(['c', 'a', 'b'])
    })

    it('retains 15 and 50 projects without silent eviction', () => {
      let list: string[] = []
      for (let i = 0; i < 15; i++) list = nextRecentProjects(list, `/proj/${i}`, false)
      expect(list).toHaveLength(15)
      expect(list[0]).toBe('/proj/14')
      expect(list[14]).toBe('/proj/0')

      for (let i = 15; i < 50; i++) list = nextRecentProjects(list, `/proj/${i}`, false)
      expect(list).toHaveLength(50)
      expect(list[0]).toBe('/proj/49')
      expect(list[49]).toBe('/proj/0')
    })

    it('caps at RECENT_PROJECTS_CAP by dropping the oldest tail entry', () => {
      expect(RECENT_PROJECTS_CAP).toBeGreaterThanOrEqual(50)
      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', false)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[0]).toBe('new')
      expect(next).toContain('p0')
      expect(next).toContain(`p${RECENT_PROJECTS_CAP - 2}`)
      expect(next).not.toContain(`p${RECENT_PROJECTS_CAP - 1}`)
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

    it('retains 15 and 50 projects in exact insertion order', () => {
      let list: string[] = []
      for (let i = 0; i < 50; i++) list = nextRecentProjects(list, `/proj/${i}`, true)
      expect(list).toHaveLength(50)
      expect(list[0]).toBe('/proj/0')
      expect(list[49]).toBe('/proj/49')
    })

    it('preserves the top/head entries and retains the newly opened project at cap', () => {
      const capped = nextRecentProjects(['p0', 'p1', 'p2', 'p3', 'p4'], 'new', true, 5)
      expect(capped).toEqual(['p0', 'p1', 'p2', 'p3', 'new'])
      expect(capped[0]).toBe('p0')
      expect(capped[capped.length - 1]).toBe('new')
      expect(capped).not.toContain('p4')

      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', true)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[0]).toBe('p0')
      expect(next[next.length - 1]).toBe('new')
      expect(next).not.toContain(`p${RECENT_PROJECTS_CAP - 1}`)
    })

    it('deduplicates Windows paths with different slash styles', () => {
      expect(nextRecentProjects(['E:\\myproject\\pi-app', 'D:\\other'], 'E:/myproject/pi-app', true)).toEqual([
        'E:\\myproject\\pi-app',
        'D:\\other',
      ])
      expect(nextRecentProjects(['D:\\other', 'E:\\myproject\\pi-app'], 'E:/myproject/pi-app', false)).toEqual([
        'E:/myproject/pi-app',
        'D:\\other',
      ])
    })
  })
})

describe('replaceRecentProjectInPlace', () => {
  it('replaces a removed worktree at its original position', () => {
    expect(replaceRecentProjectInPlace(['p0', 'wt1', 'p2'], ['wt1'], 'wt2')).toEqual(['p0', 'wt2', 'p2'])
    expect(replaceRecentProjectInPlace(['wt1', 'p1'], ['wt1'], 'wt2')).toEqual(['wt2', 'p1'])
    expect(replaceRecentProjectInPlace(['p0', 'wt1'], ['wt1'], 'wt2')).toEqual(['p0', 'wt2'])
  })

  it('does not insert a duplicate if a sibling is already present', () => {
    expect(replaceRecentProjectInPlace(['p0', 'wt1', 'wt2', 'p3'], ['wt1'], 'wt2')).toEqual(['p0', 'wt2', 'p3'])
  })
})

describe('workspaceRealPathsEqual', () => {
  it('matches directory symlinks / Windows junctions against their canonical target', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-realpath-'))
    tempRoots.push(root)
    const realDir = join(root, 'real-project')
    const linkDir = join(root, 'linked-project')
    mkdirSync(realDir, { recursive: true })
    symlinkSync(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir')

    expect(workspaceRealPathsEqual(linkDir, realDir.replace(/\\/g, '/'))).toBe(true)
    expect(workspaceRealPathsEqual(linkDir, join(root, 'other'))).toBe(false)
  })
})
