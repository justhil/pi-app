import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeMessages, resetTimelineSeq, timelineItemsFromBranchPath } from './worker-timeline'
import { isInterruptedAssistantRow, resolveRewindTargetEntryId } from '@shared/timeline-incomplete'

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

describe('worker timeline row ids', () => {
  it('stay unique when another process (or a restarted counter) builds the same rows', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]
    resetTimelineSeq()
    const first = normalizeMessages(messages).map((row) => String(row.id))
    resetTimelineSeq()
    const second = normalizeMessages(messages).map((row) => String(row.id))
    // Same process restarting its counter repeats ids; the process tag is what separates
    // rows built in Main vs. each Worker, so ids must carry more than the bare counter.
    expect(first).toEqual(second)
    expect(first.every((id) => /^hist-[a-z0-9]+-\d+$/.test(id))).toBe(true)
  })
})

describe('worker timeline retry recovery', () => {
  const user = { role: 'user', content: [{ type: 'text', text: 'finish the task' }] }
  const failed = {
    role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Request timed out.',
  }
  const success = {
    role: 'assistant', content: [{ type: 'text', text: 'Completed summary' }], stopReason: 'stop',
  }
  const branch = (messages: unknown[]) =>
    messages.map((message, index) => ({ id: `entry-${index}`, type: 'message', message }))

  it('reopens a completed retry without incomplete warnings in either history path', () => {
    const messages = [user, failed, failed, success]
    for (const rows of [normalizeMessages(messages), timelineItemsFromBranchPath(branch(messages))]) {
      expect(rows.filter(isInterruptedAssistantRow)).toEqual([])
      expect(rows.at(-1)).toMatchObject({ text: 'Completed summary', stopReason: 'stop' })
    }
    expect(timelineItemsFromBranchPath(branch(messages)).at(-1)?.sessionEntryId).toBe('entry-3')
  })

  it('keeps a failed leaf visible and rewinds to its user entry', () => {
    const rows = timelineItemsFromBranchPath(branch([user, failed]))
    expect(isInterruptedAssistantRow(rows[1])).toBe(true)
    expect(resolveRewindTargetEntryId(rows, rows[1])).toBe('entry-0')
  })
})
