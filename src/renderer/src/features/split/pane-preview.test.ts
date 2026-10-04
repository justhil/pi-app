import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { plainText, previewRows } from './pane-preview'

const it_ = (id: string, type: TimelineItem['type'], extra: Partial<TimelineItem> = {}) => ({ id, type, ...extra }) as TimelineItem

describe('previewRows', () => {
  it('keeps messages and folds tool runs into one line', () => {
    const rows = previewRows([
      it_('u', 'user-message', { text: 'hi' }),
      it_('t1', 'tool-call', { toolPhase: 'end' }),
      it_('t2', 'tool-call', { toolPhase: 'end', isError: true }),
      it_('t3', 'tool-call', { toolPhase: 'update' }),
      it_('a', 'assistant-message', { text: 'done' }),
      it_('e', 'assistant-message', { text: '  ' }),
    ])
    expect(rows).toEqual([
      { kind: 'user', id: 'u', text: 'hi' },
      { kind: 'tools', id: 't1', count: 3, failed: true, live: true },
      { kind: 'assistant', id: 'a', text: 'done' },
    ])
  })
})

describe('plainText', () => {
  it('drops markdown syntax but keeps the words', () => {
    expect(plainText('## 结论\n**没有**开源协议，见 `LICENSE` 和 [链接](http://x)')).toBe('结论\n没有开源协议，见 LICENSE 和 链接')
    expect(plainText('| 部分 | 许可 |\n|---|---|\n| src | 无 |')).toBe('部分 · 许可\n\nsrc · 无')
  })
})
