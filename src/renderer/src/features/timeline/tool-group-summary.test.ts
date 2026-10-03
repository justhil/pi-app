import { describe, expect, it } from 'vitest'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { attentionTools, groupExpanded } from './tool-group-summary'

const tool = (id: string, extra: Partial<ToolTimelineItem> = {}) => ({ id, type: 'tool-call', toolName: 'bash', toolCallId: `c-${id}`, ...extra }) as unknown as ToolTimelineItem

describe('tool group expansion', () => {
  const tools = [tool('a'), tool('b')]
  it('stays closed by default', () => {
    expect(groupExpanded(undefined, 'tg-a', tools)).toBe(false)
  })
  it('opens when the user had expanded one of its tools before sealing', () => {
    expect(groupExpanded({ 'c-b': true }, 'tg-a', tools)).toBe(true)
  })
  it("respects the user's choice for the group itself", () => {
    expect(groupExpanded({ 'c-b': true, 'tg-a': false }, 'tg-a', tools)).toBe(false)
    expect(groupExpanded({ 'tg-a': true }, 'tg-a', tools)).toBe(true)
  })
  it('keeps failures and open questions visible', () => {
    const list = [tool('a'), tool('b', { isError: true }), tool('c', { extensionUiSuspended: true } as Partial<ToolTimelineItem>)]
    expect(attentionTools(list).map((t) => t.id)).toEqual(['b', 'c'])
  })
})
