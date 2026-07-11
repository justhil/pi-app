import { describe, expect, it } from 'vitest'
import {
  buildTimelineDisplayItems,
  isThinkingOnlyAssistant,
  type TimelineRawItem,
} from './timeline-display-items'

function thinking(id: string, text: string): TimelineRawItem {
  return { id, type: 'assistant-message', text: '', thinkingText: text, timestamp: 1 }
}

function tool(id: string, name: string): TimelineRawItem {
  return { id, type: 'tool-call', toolName: name, toolPhase: 'end', timestamp: 1 }
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
    expect(isThinkingOnlyAssistant(assistant('a', '', ''))).toBe(false)
    expect(isThinkingOnlyAssistant(tool('t', 'read'))).toBe(false)
  })
})

describe('buildTimelineDisplayItems — tool merge across thinking', () => {
  it('merges contiguous tools without thinking (unchanged)', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'go'),
      tool('t1', 'read'),
      tool('t2', 'bash'),
    ])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].kind).toBe('single')
    expect(blocks[1]).toMatchObject({
      kind: 'tool-group',
      tools: [{ id: 't1' }, { id: 't2' }],
    })
  })

  it('merges tools split by thinking-only assistants and folds thinking text', () => {
    // Matches screenshot: think → write → think → read → bash → think
    const blocks = buildTimelineDisplayItems([
      user('u1', 'test tools'),
      thinking('th1', '先写临时文件'),
      tool('t1', 'write'),
      thinking('th2', '再 read grep'),
      tool('t2', 'read'),
      tool('t3', 'bash'),
      thinking('th3', '最后删掉'),
      assistant('a1', '完成了。'),
    ])

    expect(blocks.map((b) => b.kind)).toEqual(['single', 'tool-group', 'single'])
    const group = blocks[1]
    expect(group.kind).toBe('tool-group')
    if (group.kind !== 'tool-group') return
    expect(group.tools.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(group.thinkingText).toContain('先写临时文件')
    expect(group.thinkingText).toContain('再 read grep')
    expect(group.thinkingText).toContain('最后删掉')
    expect(blocks[2]).toMatchObject({ kind: 'single', item: { id: 'a1' } })
  })

  it('does not merge tools across assistant messages that have prose', () => {
    const blocks = buildTimelineDisplayItems([
      tool('t1', 'read'),
      assistant('a1', '中间说明', 'think'),
      tool('t2', 'bash'),
    ])
    expect(blocks).toHaveLength(3)
    expect(blocks[0].kind).toBe('single')
    expect(blocks[1].kind).toBe('single')
    expect(blocks[2].kind).toBe('single')
  })

  it('does not merge tools across user messages', () => {
    const blocks = buildTimelineDisplayItems([
      tool('t1', 'read'),
      user('u2', 'next'),
      tool('t2', 'bash'),
    ])
    expect(blocks).toHaveLength(3)
  })

  it('keeps orphan thinking-only as single when no tools follow', () => {
    const blocks = buildTimelineDisplayItems([
      user('u1', 'hi'),
      thinking('th1', 'only think'),
      assistant('a1', 'reply'),
    ])
    expect(blocks.map((b) => (b.kind === 'single' ? b.item.id : b.kind))).toEqual([
      'u1',
      'th1',
      'a1',
    ])
  })

  it('single tool with surrounding thinking becomes tool-group with thinkingText', () => {
    const blocks = buildTimelineDisplayItems([
      thinking('th1', 'plan'),
      tool('t1', 'read'),
      thinking('th2', 'done'),
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'tool-group',
      tools: [{ id: 't1' }],
    })
    if (blocks[0].kind === 'tool-group') {
      expect(blocks[0].thinkingText).toBe('plan\n\ndone')
    }
  })
})
