import { describe, expect, it } from 'vitest'
import { RECENT_PROJECTS_CAP, isSandboxProjectPath, nextRecentProjects } from './recent-projects'

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

    it('caps by dropping the oldest (first) entry', () => {
      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', true)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[next.length - 1]).toBe('new')
      expect(next).not.toContain('p0')
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

  describe('temporary chat folders', () => {
    const box = (id: string) => `C:\\Users\\me\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\${id}`
    // The list a fixed-order user had: real projects first, then folders of temp chats.
    const filled = ['D:\\作业', 'E:/myproject/pi-app', box('a'), box('b'), box('c'), box('d'), box('e'), 'E:\\myproject\\AegisGate', box('f'), 'E:\\myproject\\面经爬虫']

    it('should_drop_the_oldest_temp_chat_instead_of_a_project_when_a_new_temp_chat_fills_the_list', () => {
      const next = nextRecentProjects(filled, box('new'), true)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next).toContain('D:\\作业')
      expect(next).not.toContain(box('a'))
      expect(next[next.length - 1]).toBe(box('new'))
    })

    it('should_keep_every_project_when_opening_a_new_folder_in_a_list_full_of_temp_chats', () => {
      const next = nextRecentProjects(filled, 'E:\\myproject\\个人作品集合', true)
      expect(next.filter((p) => !p.includes('sandbox-workspaces'))).toEqual([
        'D:\\作业', 'E:/myproject/pi-app', 'E:\\myproject\\AegisGate', 'E:\\myproject\\面经爬虫', 'E:\\myproject\\个人作品集合',
      ])
    })

    it('should_drop_the_least_recent_temp_chat_first_in_mru_mode', () => {
      const mru = [box('newest'), 'E:\\p1', box('mid'), 'E:\\p2', 'E:\\p3', 'E:\\p4', 'E:\\p5', 'E:\\p6', box('oldest'), 'E:\\p7']
      const next = nextRecentProjects(mru, box('fresh'), false)
      expect(next[0]).toBe(box('fresh'))
      expect(next).toContain('E:\\p7')
      expect(next).not.toContain(box('oldest'))
    })

    it('should_still_drop_the_oldest_project_once_real_projects_alone_exceed_the_cap', () => {
      const projects = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `E:\\p${i}`)
      expect(nextRecentProjects(projects, 'E:\\new', true)).not.toContain('E:\\p0')
    })

    it('should_recognise_host_and_wsl_temp_chat_folders', () => {
      expect(isSandboxProjectPath(box('03c1e10b'))).toBe(true)
      expect(isSandboxProjectPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\.pi\\desktop\\sandbox-workspaces\\x1')).toBe(true)
      expect(isSandboxProjectPath('E:\\myproject\\sandbox-workspaces-notes')).toBe(false)
      expect(isSandboxProjectPath('E:\\myproject\\面经爬虫')).toBe(false)
    })
  })
})
