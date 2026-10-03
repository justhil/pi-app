import { describe, expect, it } from 'vitest'
import type { BrowserTabInfo } from '@shared/browser-types'
import { applyBrowserEvent, type BrowserState } from './browser-store'

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

const empty: BrowserState = { tabs: {}, order: [], activeTabId: null }

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
