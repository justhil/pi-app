import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from './timeline-settings'

describe('normalizeTimelineMaxAutoExpandedTools', () => {
  it('defaults invalid to 0 (Cursor-like collapsed tools)', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(undefined)).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
    expect(normalizeTimelineMaxAutoExpandedTools('x')).toBe(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS)
    expect(DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS).toBe(0)
  })

  it('allows 0 and clamps to 0–50', () => {
    expect(normalizeTimelineMaxAutoExpandedTools(0)).toBe(0)
    expect(normalizeTimelineMaxAutoExpandedTools(-3)).toBe(0)
    expect(normalizeTimelineMaxAutoExpandedTools(99)).toBe(50)
    expect(normalizeTimelineMaxAutoExpandedTools(20)).toBe(20)
  })
})
