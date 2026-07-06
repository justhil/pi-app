import { describe, expect, it } from 'vitest'
import { pickAutoExpandedToolIds } from './timeline-tool-expand-policy'

function slot(id: string, runId = 'run-1', toolPhase = 'end') {
  return { id, runId, toolPhase }
}

describe('pickAutoExpandedToolIds', () => {
  it('returns empty when agent not running', () => {
    const ids = pickAutoExpandedToolIds([slot('a')], {
      agentRunning: false,
      activeRunId: 'run-1',
    })
    expect(ids.size).toBe(0)
  })

  it('keeps only last N tools of current run', () => {
    const slots = Array.from({ length: 20 }, (_, i) => slot(`t${i}`))
    const ids = pickAutoExpandedToolIds(slots, {
      agentRunning: true,
      activeRunId: 'run-1',
      maxExpanded: 15,
    })
    expect(ids.size).toBe(15)
    expect(ids.has('t19')).toBe(true)
    expect(ids.has('t4')).toBe(false)
    expect(ids.has('t0')).toBe(false)
  })

  it('prefers running tools when present', () => {
    const slots = [
      slot('done', 'run-1', 'end'),
      slot('live', 'run-1', 'update'),
    ]
    const ids = pickAutoExpandedToolIds(slots, {
      agentRunning: true,
      activeRunId: 'run-1',
      maxExpanded: 15,
    })
    expect(ids.has('live')).toBe(true)
    expect(ids.has('done')).toBe(false)
  })
})