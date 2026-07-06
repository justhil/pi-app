import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from './timeline-settings'

describe('normalizeTimelineMaxAutoExpandedTools', () => {
  it('defaults invalid to 15', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(undefined)).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
    expect(normalizeTimelineMaxAutoExpandedTools('x')).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
  })

  it('clamps to 1–50', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(0)).toBe(1)
    expect(normalizeTimelineMaxAutoExpandedTools(99)).toBe(50)
    expect(normalizeTimelineMaxAutoExpandedTools(20)).toBe(20)
  })
})