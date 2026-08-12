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
