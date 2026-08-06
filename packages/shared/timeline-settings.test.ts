import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from './timeline-settings'

describe('normalizeTimelineMaxAutoExpandedTools', () => {
  it('defaults invalid to default window size', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(undefined)).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
    expect(normalizeTimelineMaxAutoExpandedTools('x')).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
    expect(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS).toBe(5)
  })

  it('allows 0 and clamps to 0–50', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(0)).toBe(0)
    expect(normalizeTimelineMaxAutoExpandedTools(-3)).toBe(0)
    expect(normalizeTimelineMaxAutoExpandedTools(99)).toBe(50)
    expect(normalizeTimelineMaxAutoExpandedTools(20)).toBe(20)
  })
})
