import { describe, expect, it } from 'vitest'
import {
  detectTimelineGap,
  isTimelineCatchUpComplete,
  nextLoadedOffsetAfterPage,
  planResumeTimelineSync,
} from './session-timeline-sync-plan'

describe('session-timeline-sync-plan', () => {
  it('catch-up incomplete when offset below totalCount', () => {
    expect(isTimelineCatchUpComplete({ totalCount: 200, loadedOffsetFromEnd: 80 })).toBe(false)
    expect(isTimelineCatchUpComplete({ totalCount: 200, loadedOffsetFromEnd: 200 })).toBe(true)
  })

  it('planResume uses after when cursor partial', () => {
    const plan = planResumeTimelineSync({ totalCount: 100, loadedOffsetFromEnd: 40 })
    expect(plan.direction).toBe('after')
    expect(plan).toMatchObject({ offset: 40 })
  })

  it('detects entry id gap', () => {
    expect(detectTimelineGap({ authoritativeLastEntryId: 'a', liveFirstEntryId: 'b' })).toBe(true)
    expect(detectTimelineGap({ authoritativeLastEntryId: 'a', liveFirstEntryId: 'a' })).toBe(false)
  })

  it('advances loaded offset after page', () => {
    expect(nextLoadedOffsetAfterPage({ previousLoadedOffsetFromEnd: 80, pageItemCount: 80, totalCount: 200 })).toBe(160)
  })
})