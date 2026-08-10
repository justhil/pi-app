import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeMessages, resetTimelineSeq, timelineItemsFromBranchPath } from './worker-timeline'

const expandedSkill = `<skill name="demo-skill" location="/skills/demo-skill/SKILL.md">
References are relative to /skills/demo-skill.

# Demo

Secret skill body.
</skill>

explain this`

const details = {
  mode: 'single',
  runId: 'run-subagent-1',
  results: [{ agent: 'scout', exitCode: 1, error: 'network reset' }],
}

describe('worker timeline tool-result projection', () => {
  beforeEach(() => resetTimelineSeq())

  it('projects expanded skill user messages without leaking the skill body', () => {
    expect(
      normalizeMessages([
        { role: 'user', content: [{ type: 'text', text: expandedSkill }] },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        type: 'user-message',
        text: '/skill:demo-skill explain this',
      }),
    )

    expect(
      timelineItemsFromBranchPath([
        {
          id: 'skill-entry',
          type: 'message',
          message: { role: 'user', content: [{ type: 'text', text: expandedSkill }] },
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        type: 'user-message',
        text: '/skill:demo-skill explain this',
        sessionEntryId: 'skill-entry',
      }),
    )
  })

  it('preserves tool identity and structured details when reopening history', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'subagent',
            arguments: { agent: 'scout', task: 'inspect the renderer' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'subagent',
        content: [{ type: 'text', text: 'failed' }],
        details,
        isError: true,
      },
    ]

    const normalizedTool = normalizeMessages(messages).find((item) => item.type === 'tool-call')
    expect(normalizedTool).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'subagent',
      toolOutput: 'failed',
      toolDetails: details,
      isError: true,
    })

    resetTimelineSeq()
    const branchTool = timelineItemsFromBranchPath([
      { id: 'assistant-entry', type: 'message', message: messages[0] },
      { id: 'tool-entry', type: 'message', message: messages[1] },
    ]).find((item) => item.type === 'tool-call')
    expect(branchTool).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'subagent',
      toolOutput: 'failed',
      toolDetails: details,
      isError: true,
    })
  })
})

describe('timelineItemsFromBranchPath non-message entries', () => {
  beforeEach(() => resetTimelineSeq())

  const metaEntries = [
    {
      id: 'model-1',
      type: 'model_change',
      timestamp: '2026-08-06T12:46:34.504Z',
      provider: 'acme',
      modelId: 'claude-fable-5',
    },
    {
      id: 'think-1',
      type: 'thinking_level_change',
      timestamp: '2026-08-06T12:46:34.504Z',
      thinkingLevel: 'high',
    },
    { id: 'user-1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
  ]

  it('omits meta entries by default (showNonMessageEntries=false)', () => {
    const items = timelineItemsFromBranchPath(metaEntries)
    expect(items.some((i) => i.type === 'model-change')).toBe(false)
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('user-message')
  })

  it('merges adjacent model_change + thinking_level_change into one model-change entry', () => {
    const items = timelineItemsFromBranchPath(metaEntries, { showNonMessageEntries: true })
    const meta = items.filter((i) => i.type === 'model-change')
    expect(meta).toHaveLength(1)
    expect(meta[0]).toMatchObject({
      model: 'acme/claude-fable-5',
      thinkingLevel: 'high',
      sessionEntryId: 'think-1',
    })
    expect(items.map((i) => i.type)).toEqual(['model-change', 'user-message'])
  })

  it('supports reverse order (thinking first, model second)', () => {
    const reversed = [
      { id: 't', type: 'thinking_level_change', thinkingLevel: 'low', timestamp: '2026-08-06T00:00:00Z' },
      { id: 'm', type: 'model_change', provider: 'acme', modelId: 'x', timestamp: '2026-08-06T00:00:00Z' },
      { id: 'u', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
    ]
    const meta = timelineItemsFromBranchPath(reversed, { showNonMessageEntries: true }).find(
      (i) => i.type === 'model-change',
    )
    expect(meta).toMatchObject({ model: 'acme/x', thinkingLevel: 'low' })
  })

  it('flushes pending meta before a following message', () => {
    const path = [
      { id: 'm', type: 'model_change', provider: 'acme', modelId: 'a', timestamp: '2026-08-06T00:00:00Z' },
      { id: 'u', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      { id: 'm2', type: 'model_change', provider: 'acme', modelId: 'b', timestamp: '2026-08-06T00:01:00Z' },
    ]
    const metas = timelineItemsFromBranchPath(path, { showNonMessageEntries: true }).filter(
      (i) => i.type === 'model-change',
    )
    expect(metas).toHaveLength(2)
    expect(metas[0]).toMatchObject({ model: 'acme/a' })
    expect(metas[1]).toMatchObject({ model: 'acme/b' })
  })
})
