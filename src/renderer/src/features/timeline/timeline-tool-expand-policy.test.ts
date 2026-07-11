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
      maxExpanded: 15,
    })
    expect(ids.size).toBe(0)
  })

  it('returns empty when maxExpanded is 0', () => {
    const slots = Array.from({ length: 5 }, (_, i) => slot(`t${i}`, 'run-1', 'update'))
    const ids = pickAutoExpandedToolIds(slots, {
      agentRunning: true,
      activeRunId: 'run-1',
      maxExpanded: 0,
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

  it('includes completed tools in the budget while agent is running', () => {
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
    expect(ids.has('done')).toBe(true)
  })

  it('ignores tools from other runs', () => {
    const slots = [slot('other', 'run-old', 'end'), slot('cur', 'run-1', 'end')]
    const ids = pickAutoExpandedToolIds(slots, {
      agentRunning: true,
      activeRunId: 'run-1',
      maxExpanded: 15,
    })
    expect(ids.has('cur')).toBe(true)
    expect(ids.has('other')).toBe(false)
  })
})
