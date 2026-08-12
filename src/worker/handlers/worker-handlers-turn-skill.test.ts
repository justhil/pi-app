import { afterEach, describe, expect, it } from 'vitest'
import { handleClearqueue } from './worker-handlers-turn'
import { st } from '../worker-runtime'

const expandedSkill = `<skill name="demo-skill" location="/skills/demo-skill/SKILL.md">
References are relative to /skills/demo-skill.

# Demo

Secret skill body.
</skill>

queued arg`

const originalSession = st.session

afterEach(() => {
  st.session = originalSession
})

describe('handleClearqueue display projection', () => {
  it('returns literal skill commands without mutating the SDK queue contract', async () => {
    const cleared = { steering: [expandedSkill], followUp: [expandedSkill] }
    const replies: Record<string, unknown>[] = []
    st.session = { clearQueue: () => cleared } as never

    await handleClearqueue({ type: 'clearQueue' } as never, (payload) => replies.push(payload))

    expect(cleared).toEqual({ steering: [expandedSkill], followUp: [expandedSkill] })
    expect(replies).toEqual([
      {
        type: 'clearQueue-done',
        steering: ['/skill:demo-skill queued arg'],
        followUp: ['/skill:demo-skill queued arg'],
      },
    ])
  })
})
