import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { paneDigest, pickPreviewSource, plainText, previewRows } from './pane-preview'

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

describe('pickPreviewSource', () => {
  const u = it_('u', 'user-message', { text: 'q' })
  const a = it_('a', 'assistant-message', { text: 'answer' })
  it('prefers a source whose latest turn has its answer', () => {
    expect(pickPreviewSource([u], [u, a], null)).toEqual([u, a])
    expect(pickPreviewSource([u, a], [u], null)).toEqual([u, a])
  })
  it('follows a running turn that is ahead of the disk', () => {
    const u2 = it_('u2', 'user-message', { text: 'next' })
    expect(pickPreviewSource([u, a, u2], [u, a], null)).toEqual([u, a, u2])
  })
  it('falls back to whatever exists', () => {
    expect(pickPreviewSource(null, null, [u])).toEqual([u])
    expect(pickPreviewSource(null, null, null)).toBeNull()
  })
})

describe('paneDigest', () => {
  it('summarises the latest turn: question, reply so far and tool activity', () => {
    const items = [
      it_('u1', 'user-message', { text: 'first' }),
      it_('a1', 'assistant-message', { text: 'old answer' }),
      it_('u2', 'user-message', { text: 'fix the **build**' }),
      it_('t1', 'tool-call', { toolPhase: 'end' }),
      it_('t2', 'tool-call', { toolPhase: 'update' }),
    ]
    expect(paneDigest(items)).toEqual({ lastUser: 'fix the build', lastReply: '', tools: 2, toolLive: true, turns: 2 })
    expect(paneDigest([...items, it_('a2', 'assistant-message', { text: 'done' })]).lastReply).toBe('done')
    expect(paneDigest(null).turns).toBe(0)
  })
})
