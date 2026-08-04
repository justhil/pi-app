import { describe, expect, it } from 'vitest'
import { isSubagentSessionPreview } from './subagent-session-preview'

describe('subagent session preview identity', () => {
  it('should_remain_read_only_after_running_sidebar_children_are_reclaimed', () => {
    expect(isSubagentSessionPreview({
      workspacePath: '/workspace',
      parentSessionId: 'parent-session',
      parentSessionFile: '/sessions/parent.jsonl',
      previewSessionFile: '/sessions/child.jsonl',
      children: [],
    }, '/sessions/child.jsonl')).toBe(true)
  })
})
