import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeMessages, resetTimelineSeq, timelineItemsFromBranchPath } from './worker-timeline'

const details = {
  mode: 'single',
  runId: 'run-subagent-1',
  results: [{ agent: 'scout', exitCode: 1, error: 'network reset' }],
}

describe('worker timeline tool-result projection', () => {
  beforeEach(() => resetTimelineSeq())

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
