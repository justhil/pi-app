import { beforeEach, describe, expect, it } from 'vitest'
import {
  arrangeRecentProjects,
  moveItem,
  moveRanked,
  orderByRank,
  readSessionRanks,
  writeSessionRanks,
  type SessionRanks,
} from './sidebar-manual-order'

type Row = { key: string; updatedAt: number }
const key = (row: Row) => row.key
const time = (row: Row) => row.updatedAt
// As listed by the main process: newest first.
const rows: Row[] = [{ key: 'a', updatedAt: 500 }, { key: 'b', updatedAt: 400 }, { key: 'c', updatedAt: 300 }, { key: 'd', updatedAt: 200 }]
const shown = (ranks: SessionRanks, list = rows) => orderByRank(list, key, time, ranks).map(key)
// When the drags in these tests happen: after every listed time, before any later message.
const NOW = 600

describe('conversation order', () => {
  it('should_keep_the_listed_order_when_nothing_was_dragged', () => {
    expect(shown({})).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should_move_a_conversation_up_and_down', () => {
    expect(shown(moveRanked(rows, 'd', 'a', 'before', key, time, {}, NOW))).toEqual(['d', 'a', 'b', 'c'])
    expect(shown(moveRanked(rows, 'a', 'c', 'after', key, time, {}, NOW))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('should_build_on_an_earlier_drag', () => {
    const first = moveRanked(rows, 'd', 'a', 'before', key, time, {}, NOW)
    const listed = orderByRank(rows, key, time, first)
    expect(shown(moveRanked(listed, 'b', 'd', 'before', key, time, first, NOW))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('should_send_a_dragged_conversation_to_the_top_when_it_gets_a_new_message', () => {
    const ranks = moveRanked(rows, 'a', 'd', 'after', key, time, {}, NOW)
    expect(shown(ranks)).toEqual(['b', 'c', 'd', 'a'])
    const updated = rows.map((row) => row.key === 'a' ? { ...row, updatedAt: 900 } : row)
    expect(shown(ranks, updated)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should_keep_other_dragged_places_when_another_conversation_moves_up', () => {
    const ranks = moveRanked(rows, 'd', 'a', 'before', key, time, {}, NOW)
    const updated = rows.map((row) => row.key === 'c' ? { ...row, updatedAt: 900 } : row)
    expect(shown(ranks, updated)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('should_place_a_new_conversation_above_dragged_ones', () => {
    const ranks = moveRanked(rows, 'd', 'a', 'before', key, time, {}, NOW)
    expect(shown(ranks, [{ key: 'new', updatedAt: 1000 }, ...rows])).toEqual(['new', 'd', 'a', 'b', 'c'])
  })

  it('should_order_conversations_with_the_same_time', () => {
    const same = rows.map((row) => ({ ...row, updatedAt: 100 }))
    const ranks = moveRanked(same, 'c', 'a', 'before', key, time, {}, NOW)
    expect(shown(ranks, same)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('should_keep_the_order_when_times_read_back_from_disk_are_a_little_later', () => {
    const ranks = moveRanked(rows, 'd', 'a', 'before', key, time, {}, NOW)
    const fromDisk = rows.map((row) => ({ ...row, updatedAt: row.updatedAt + 50 }))
    expect(shown(ranks, fromDisk)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('should_ignore_a_drop_on_itself_or_an_unknown_row', () => {
    const ranks = { b: { rank: 1, at: 400 } }
    expect(moveRanked(rows, 'a', 'a', 'before', key, time, ranks)).toBe(ranks)
    expect(moveRanked(rows, 'zz', 'a', 'before', key, time, ranks)).toBe(ranks)
  })
})

describe('stored conversation order', () => {
  beforeEach(() => localStorage.clear())

  it('should_keep_each_project_apart_and_forget_an_empty_one', () => {
    writeSessionRanks('e:/p1', { a: { rank: 1, at: 2 } })
    writeSessionRanks('e:/p2', { b: { rank: 3, at: 4 } })
    expect(readSessionRanks('e:/p1')).toEqual({ a: { rank: 1, at: 2 } })
    writeSessionRanks('e:/p1', {})
    expect(readSessionRanks('e:/p1')).toEqual({})
    expect(readSessionRanks('e:/p2')).toEqual({ b: { rank: 3, at: 4 } })
  })

  it('should_survive_unreadable_storage', () => {
    localStorage.setItem('pi-desktop:sidebar-session-order', '{not json')
    expect(readSessionRanks('e:/p1')).toEqual({})
  })
})

describe('project order', () => {
  const box = 'C:\\Users\\me\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\x1'

  it('should_move_an_item_before_or_after_another', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0, 'before')).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2, 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b'], 1, 1, 'before')).toEqual(['a', 'b'])
  })

  it('should_write_the_shown_order_back_and_keep_hidden_entries_after_it', () => {
    const recent = ['E:/myproject/pi-app', box, 'D:\\作业', 'E:\\myproject\\面经爬虫']
    expect(arrangeRecentProjects(recent, [['E:\\myproject\\面经爬虫'], ['E:\\myproject\\pi-app'], ['D:\\作业']])).toEqual([
      'E:\\myproject\\面经爬虫', 'E:/myproject/pi-app', 'D:\\作业', box,
    ])
  })

  it('should_move_every_checkout_of_a_repository_group_together', () => {
    const recent = ['E:/repo', 'E:/other', 'E:/repo/.claude/worktrees/x']
    expect(arrangeRecentProjects(recent, [['E:/other'], ['E:/repo', 'E:/repo/.claude/worktrees/x']])).toEqual([
      'E:/other', 'E:/repo', 'E:/repo/.claude/worktrees/x',
    ])
  })

  it('should_keep_a_project_added_since_the_sidebar_last_read_the_list', () => {
    expect(arrangeRecentProjects(['E:/a', 'E:/b', 'E:/new'], [['E:/b'], ['E:/a']])).toEqual(['E:/b', 'E:/a', 'E:/new'])
  })
})
