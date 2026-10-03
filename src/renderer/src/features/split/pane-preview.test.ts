import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { previewRows } from './pane-preview'

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
