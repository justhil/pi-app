// browser_request_help (BrowserSkill's request-help): the agent hands one step to the user —
// sign-in, CAPTCHA, 2FA, a payment confirmation — and waits until the user says done, gives up,
// an optional URL/text condition is met, the time runs out, or the turn is stopped.

import { randomUUID } from 'node:crypto'
import type { BrowserEvent, BrowserHelpOutcome, BrowserHelpRequest } from '@shared/browser-types'
import { BrowserToolError } from './errors'

export interface HelpUntil {
  urlContains?: string
  urlMatches?: string
  textAppears?: string
}

export interface HelpWait {
  tabId: string
  sessionKey: string
  prompt: string
  target?: string
  until?: HelpUntil
  timeoutSec: number
  where: BrowserHelpRequest['where']
  /** A yes/no question (borrowing a tab) rather than a task. */
  confirm?: boolean
  signal?: AbortSignal
  emit(event: BrowserEvent): void
  url(): string
  hasText(text: string): Promise<boolean>
  tabOpen(): boolean
}

const POLL_MS = 1000
const open = new Map<string, { request: BrowserHelpRequest; finish: (o: BrowserHelpOutcome, why?: string) => void; sessionKey: string }>()

/** Compile the URL pattern up front so a bad one fails the call, not the wait. */
export function compileUntil(until: HelpUntil | undefined): { re: RegExp | null; label?: string } {
  if (!until) return { re: null }
  let re: RegExp | null = null
  if (until.urlMatches) {
    try {
      re = new RegExp(until.urlMatches)
    } catch (error) {
      throw new BrowserToolError('browser_denied', `until.urlMatches is not a valid regular expression: ${(error as Error).message}`)
    }
  }
  const parts = [
    until.urlContains ? `URL contains ${until.urlContains}` : '',
    until.urlMatches ? `URL matches /${until.urlMatches}/` : '',
    until.textAppears ? `page shows "${until.textAppears}"` : '',
  ].filter(Boolean)
  return { re, label: parts.length ? parts.join(' or ') : undefined }
}

/** Requests waiting on the user, so a reloaded window can show them again. */
export function openHelpRequests(): BrowserHelpRequest[] {
  return [...open.values()].map((o) => o.request)
}

/** The user pressed Done / Give up in the panel. */
export function respondHelp(id: string, outcome: 'completed' | 'cancelled'): boolean {
  const o = open.get(id)
  if (!o) return false
  o.finish(outcome, outcome === 'completed' ? 'the user said done' : 'the user gave up')
  return true
}

export async function waitForHelp(w: HelpWait): Promise<{ outcome: BrowserHelpOutcome; reason: string }> {
  for (const o of open.values()) if (o.sessionKey === w.sessionKey) throw new BrowserToolError('browser_denied', 'a help request is already open for this conversation')
  const { re, label } = compileUntil(w.until)
  const request: BrowserHelpRequest = { id: randomUUID(), tabId: w.tabId, prompt: w.prompt, target: w.target, until: label, timeoutSec: w.timeoutSec, startedAt: Date.now(), where: w.where, ...(w.confirm ? { confirm: true } : {}) }
  return new Promise((resolve) => {
    let done = false
    let poll: NodeJS.Timeout | undefined
    const finish = (outcome: BrowserHelpOutcome, reason = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(poll)
      w.signal?.removeEventListener('abort', onAbort)
      open.delete(request.id)
      w.emit({ type: 'help-ended', id: request.id, outcome })
      resolve({ outcome, reason })
    }
    const onAbort = () => finish('aborted', 'the turn was stopped')
    const timer = setTimeout(() => finish('timed_out', `no answer in ${w.timeoutSec}s`), w.timeoutSec * 1000)
    w.signal?.addEventListener('abort', onAbort)
    open.set(request.id, { request, finish, sessionKey: w.sessionKey })
    w.emit({ type: 'help-request', request })
    const check = async () => {
      if (done) return
      if (!w.tabOpen()) return finish('cancelled', 'the tab was closed')
      const url = w.url()
      if (w.until?.urlContains && url.includes(w.until.urlContains)) return finish('completed', `URL now contains ${w.until.urlContains}`)
      if (re?.test(url)) return finish('completed', `URL now matches /${w.until?.urlMatches}/`)
      if (w.until?.textAppears && (await w.hasText(w.until.textAppears).catch(() => false))) return finish('completed', `the page shows "${w.until.textAppears}"`)
      if (!done) poll = setTimeout(check, POLL_MS)
    }
    if (w.signal?.aborted) onAbort()
    else poll = setTimeout(check, POLL_MS)
  })
}
