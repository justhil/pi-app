import { describe, expect, it } from 'vitest'
import {
  buildTimelineDisplayItems,
  isThinkingOnlyAssistant,
  canFoldAssistantIntoCluster,
  isActivitySegmentSealed,
  type TimelineRawItem,
} from './timeline-display-items'

function thinking(id: string, text: string): TimelineRawItem {
  return { id, type: 'assistant-message', text: '', thinkingText: text, timestamp: 1 }
}

function tool(id: string, name: string, phase: string = 'end'): TimelineRawItem {
  return { id, type: 'tool-call', toolName: name, toolPhase: phase, timestamp: 1 }
}

function assistant(id: string, text: string, thinkingText = ''): TimelineRawItem {
  return { id, type: 'assistant-message', text, thinkingText, timestamp: 1 }
}

function user(id: string, text: string): TimelineRawItem {
  return { id, type: 'user-message', text, timestamp: 1 }
}

describe('isThinkingOnlyAssistant', () => {
  it('detects thinking-only bubbles', () => {
    expect(isThinkingOnlyAssistant(thinking('a', 'plan'))).toBe(true)
    expect(isThinkingOnlyAssistant(assistant('a', 'hello', 'plan'))).toBe(false)
  })
})

describe('canFoldAssistantIntoCluster', () => {
  it('never folds prose assistants', () => {
    const items = [tool('t1', 'read'), assistant('a1', '中间说明'), tool('t2', 'bash')]
    expect(canFoldAssistantIntoCluster(items, 1)).toBe(false)
  })
})

describe('isActivitySegmentSealed', () => {
  it('seals only when next item is prose', () => {
    const items = [tool('t1', 'read'), assistant('a1', 'done')]
    expect(isActivitySegmentSealed(items, 1)).toBe(true)
    expect(isActivitySegmentSealed([tool('t1', 'read')], 1)).toBe(false)
  })
})

describe('buildTimelineDisplayItems — flat until prose seals', () => {
  it('keeps open tool activity flat (no summary hierarchy)', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'go'),
      thinking('th1', 'plan'),
      tool('t1', 'read', 'start'),
      tool('t2', 'bash', 'start'),
    ])
    expect(blocks.map((block) => block.kind)).toEqual([
      'single',
      'single',
      'single',
      'single',
    ])
    expect(blocks.map((block) => (block.kind === 'single' ? block.item.id : block.kind))).toEqual([
      'u1',
      'th1',
      't1',
      't2',
    ])
  })

  it('collapses prior tools into summary only after prose appears', () => {
    const open = buildTimelineDisplayItems([tool('t1', 'read'), tool('t2', 'bash')])
    expect(open.every((block) => block.kind === 'single')).toBe(true)

    const sealed = buildTimelineDisplayItems([
      tool('t1', 'read'),
      tool('t2', 'bash'),
      assistant('a1', '中间结论'),
    ])
    expect(sealed.map((block) => block.kind)).toEqual(['tool-group', 'single'])
    if (sealed[0].kind === 'tool-group') {
      expect(sealed[0].groupId).toBe('tg-t1')
      expect(sealed[0].tools.map((row) => row.id)).toEqual(['t1', 't2'])
    }
    expect(sealed[1]).toMatchObject({ kind: 'single', item: { id: 'a1' } })
  })

  it('merges thinking into sealed group after prose', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'test'),
      thinking('th1', '先写'),
      tool('t1', 'write'),
      thinking('th2', '再读'),
      tool('t2', 'read'),
      assistant('a1', '完成了。'),
    ])
    expect(blocks.map((block) => block.kind)).toEqual(['single', 'tool-group', 'single'])
    if (blocks[1].kind !== 'tool-group') return
    expect(blocks[1].tools.map((row) => row.id)).toEqual(['t1', 't2'])
    expect(blocks[1].thinkingText).toContain('先写')
    expect(blocks[1].thinkingText).toContain('再读')
  })

  it('seals each tool segment when its following prose arrives', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'go'),
      thinking('th1', 'plan'),
      tool('t1', 'read'),
      tool('t2', 'grep'),
      assistant('a1', '中间结论'),
      thinking('th2', 'next'),
      tool('t3', 'edit'),
      assistant('a2', '最终回答'),
    ])
    expect(blocks.map((block) => block.kind)).toEqual([
      'single',
      'tool-group',
      'single',
      'tool-group',
      'single',
    ])
    if (blocks[1].kind === 'tool-group') {
      expect(blocks[1].tools.map((row) => row.id)).toEqual(['t1', 't2'])
    }
    if (blocks[3].kind === 'tool-group') {
      expect(blocks[3].tools.map((row) => row.id)).toEqual(['t3'])
    }
  })

  it('keeps tools after prose flat until the next prose seals them', () => {
    const mid = buildTimelineDisplayItems([
      tool('t1', 'read'),
      assistant('a1', '中间'),
      tool('t2', 'edit', 'start'),
    ])
    expect(mid.map((block) => block.kind)).toEqual(['tool-group', 'single', 'single'])
    expect(mid[2]).toMatchObject({ kind: 'single', item: { id: 't2' } })
  })

  it('absorbs empty tool-bridge shells while flat', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'test'),
      { id: 'a-empty', type: 'assistant-message', text: '', thinkingText: '' },
      tool('t1', 'write', 'start'),
    ])
    expect(blocks.map((block) => (block.kind === 'single' ? block.item.id : block.kind))).toEqual([
      'u1',
      't1',
    ])
  })

  it('does not merge tools across user messages', () => {
    const blocks = buildTimelineDisplayItems([
      tool('t1', 'read'),
      user('u2', 'next'),
      tool('t2', 'bash'),
    ])
    expect(blocks.map((block) => (block.kind === 'single' ? block.item.id : block.kind))).toEqual([
      't1',
      'u2',
      't2',
    ])
  })

  it('keeps orphan thinking as single when no tools follow', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'hi'),
      thinking('th1', 'only think'),
      assistant('a1', 'reply'),
    ])
    expect(blocks.map((block) => (block.kind === 'single' ? block.item.id : block.kind))).toEqual([
      'u1',
      'th1',
      'a1',
    ])
  })
})
