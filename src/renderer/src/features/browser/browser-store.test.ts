import { describe, expect, it } from 'vitest'
import type { BrowserTabInfo } from '@shared/browser-types'
import {
  adoptBrowserSessionInState,
  applyBrowserEvent,
  switchBrowserSession,
  visibleTabOrder,
  type BrowserState,
} from './browser-store'

const tab = (tabId: string, patch: Partial<BrowserTabInfo> = {}): BrowserTabInfo => ({
  tabId,
  engine: 'electron',
  profileId: 'default-electron',
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  openedBy: 'user',
  ...patch,
})

const empty: BrowserState = { tabs: {}, order: [], activeTabId: null, downloads: {}, helpRequests: {} }

describe('applyBrowserEvent', () => {
  it('appends new tabs and updates existing ones in place', () => {
    let s = applyBrowserEvent(empty, { type: 'tab-updated', tab: tab('a') })
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('b') })
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('a', { title: 'A' }) })
    expect(s.order).toEqual(['a', 'b'])
    expect(s.tabs.a.title).toBe('A')
  })

  it('removes closed tabs and clears focus when the active one closes', () => {
    let s = applyBrowserEvent(empty, { type: 'tab-updated', tab: tab('a') })
    s = applyBrowserEvent(s, { type: 'tab-focused', tabId: 'a' })
    s = applyBrowserEvent(s, { type: 'tab-closed', tabId: 'a' })
    expect(s).toEqual(empty)
  })

  it('ignores unknown closes and side events', () => {
    expect(applyBrowserEvent(empty, { type: 'tab-closed', tabId: 'x' })).toBe(empty)
    expect(applyBrowserEvent(empty, { type: 'shortcut', action: 'new-tab' })).toBe(empty)
  })
})

describe('downloads', () => {
  it('keeps the latest state of each download', () => {
    const d = { id: 'd1', url: 'https://x.test/f.zip', fileName: 'f.zip', savePath: '/d/f.zip', received: 10, total: 100, speed: 5, state: 'progressing' as const, via: 'aria2' as const, startedAt: 1 }
    let s = applyBrowserEvent(empty, { type: 'download-updated', download: d })
    s = applyBrowserEvent(s, { type: 'download-updated', download: { ...d, received: 100, state: 'completed' } })
    expect(Object.values(s.downloads)).toEqual([{ ...d, received: 100, state: 'completed' }])
  })
})

describe('help requests', () => {
  it('adds a request and drops it when it ends', () => {
    const request = { id: 'h1', tabId: 't1', prompt: 'Sign in', timeoutSec: 600, startedAt: 1, where: 'builtin' as const }
    let s = applyBrowserEvent(empty, { type: 'help-request', request })
    expect(s.helpRequests).toEqual({ h1: request })
    s = applyBrowserEvent(s, { type: 'help-ended', id: 'h1', outcome: 'completed' })
    expect(s.helpRequests).toEqual({})
    expect(applyBrowserEvent(s, { type: 'help-ended', id: 'nope', outcome: 'cancelled' })).toBe(s)
  })
})

describe('session tab isolation and pinned tabs', () => {
  it('filters tabs by session, orders pinned tabs first, and switches activeTabId per session', () => {
    let s = switchBrowserSession(empty, '/s1.jsonl')
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('t1', { openedBy: { sessionKey: '/s1.jsonl' }, url: 'https://s1.test/' }) })
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('t2', { openedBy: { sessionKey: '/s2.jsonl' }, url: 'https://s2.test/' }) })
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('pin1', { openedBy: { sessionKey: '/s2.jsonl' }, pinned: true, url: 'https://docs.test/' }) })

    expect(visibleTabOrder(s, '/s1.jsonl')).toEqual(['pin1', 't1'])
    expect(visibleTabOrder(s, '/s2.jsonl')).toEqual(['pin1', 't2'])
    expect(visibleTabOrder(s, '/s3.jsonl')).toEqual(['pin1'])
    expect(s.activeTabId).toBe('t1')

    // Switch to s2: activeTabId switches to s2's own tab
    s = switchBrowserSession(s, '/s2.jsonl')
    expect(s.activeTabId).toBe('t2')

    // Switch to s3 (no own tabs): falls back to the pinned tab
    s = switchBrowserSession(s, '/s3.jsonl')
    expect(s.activeTabId).toBe('pin1')

    // Switch back to s1: remembers t1
    s = switchBrowserSession(s, '/s1.jsonl')
    expect(s.activeTabId).toBe('t1')
  })

  it('clears activeTabId when switching to a session with no own or pinned tabs', () => {
    let s = switchBrowserSession(empty, '/s1.jsonl')
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('t1', { openedBy: { sessionKey: '/s1.jsonl' } }) })
    expect(s.activeTabId).toBe('t1')

    s = switchBrowserSession(s, '/empty-session.jsonl')
    expect(s.activeTabId).toBeNull()
  })

  it('adopts draft session tabs when materialized into a session file', () => {
    let s = switchBrowserSession(empty, '\u0000draft')
    s = applyBrowserEvent(s, { type: 'tab-updated', tab: tab('draft-tab', { openedBy: { sessionKey: '\u0000draft' } }) })
    s = adoptBrowserSessionInState(s, '\u0000draft', '/created.jsonl')
    expect(s.tabs['draft-tab'].openedBy).toEqual({ sessionKey: '/created.jsonl' })
    expect(s.activeSessionKey).toBe('/created.jsonl')
    expect(visibleTabOrder(s, '/created.jsonl')).toEqual(['draft-tab'])
  })
})
