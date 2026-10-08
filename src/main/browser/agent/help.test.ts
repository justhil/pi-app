import { describe, expect, it } from 'vitest'
import type { BrowserEvent } from '@shared/browser-types'
import { compileUntil, openHelpRequests, respondHelp, waitForHelp, type HelpWait } from './help'

function wait(over: Partial<HelpWait> = {}) {
  const events: BrowserEvent[] = []
  const state = { url: 'https://site.test/login', open: true }
  const p = waitForHelp({
    tabId: 't1',
    sessionKey: over.sessionKey ?? 's1',
    prompt: 'Please sign in',
    timeoutSec: 30,
    where: 'builtin',
    emit: (e) => events.push(e),
    url: () => state.url,
    hasText: async () => false,
    tabOpen: () => state.open,
    ...over,
  })
  return { p, events, state }
}

const requestId = (events: BrowserEvent[]) => (events.find((e) => e.type === 'help-request') as Extract<BrowserEvent, { type: 'help-request' }>).request.id

describe('waitForHelp', () => {
  it('completes when the user says done, and tells the panel', async () => {
    const { p, events } = wait()
    expect(openHelpRequests()).toHaveLength(1)
    expect(respondHelp(requestId(events), 'completed')).toBe(true)
    expect((await p).outcome).toBe('completed')
    expect(events.at(-1)).toMatchObject({ type: 'help-ended', outcome: 'completed' })
    expect(openHelpRequests()).toHaveLength(0)
  })

  it('cancels when the user gives up', async () => {
    const { p, events } = wait()
    respondHelp(requestId(events), 'cancelled')
    expect((await p).outcome).toBe('cancelled')
  })

  it('completes on the URL condition', async () => {
    const { p, state } = wait({ until: { urlMatches: '/dash(board)?$' } })
    state.url = 'https://site.test/dashboard'
    expect(await p).toEqual({ outcome: 'completed', reason: 'URL now matches //dash(board)?$/' })
  })

  it('times out, aborts, and notices a closed tab', async () => {
    expect((await wait({ timeoutSec: 0.05 }).p).outcome).toBe('timed_out')
    const abort = new AbortController()
    const a = wait({ signal: abort.signal })
    abort.abort()
    expect((await a.p).outcome).toBe('aborted')
    const c = wait()
    c.state.open = false
    expect(await c.p).toEqual({ outcome: 'cancelled', reason: 'the tab was closed' })
  })

  it('allows one open request per conversation and rejects bad patterns', async () => {
    const first = wait()
    await expect(wait().p).rejects.toThrow(/already open/)
    respondHelp(requestId(first.events), 'completed')
    await first.p
    expect(() => compileUntil({ urlMatches: '(' })).toThrow(/not a valid regular expression/)
    expect(compileUntil({ urlContains: '/home', textAppears: 'Welcome' }).label).toBe('URL contains /home or page shows "Welcome"')
  })
})
