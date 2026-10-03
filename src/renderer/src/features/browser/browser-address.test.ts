import { describe, expect, it } from 'vitest'
import type { BrowserTabInfo } from '@shared/browser-types'
import { buildSuggestions } from './address-suggestions'
import { recordVisit } from './browser-history'
import { clampViewport, fitViewport } from './viewport-mode'

const SEARCH = 'https://www.bing.com/search?q='
const tab = (tabId: string, url: string, title: string) => ({ tabId, url, title }) as BrowserTabInfo

describe('buildSuggestions', () => {
  const history = recordVisit(recordVisit([], 'https://github.com/vastsa/PI-Desktop', 'PI-Desktop'), 'https://docs.github.com/en', 'GitHub Docs')
  it('states whether Enter opens an address or searches', () => {
    expect(buildSuggestions('example.com', { tabs: [], activeTabId: null, history: [], searchUrl: SEARCH })[0]).toEqual({ kind: 'open', url: 'https://example.com' })
    expect(buildSuggestions('how to cook', { tabs: [], activeTabId: null, history: [], searchUrl: SEARCH })[0]).toMatchObject({ kind: 'search', query: 'how to cook' })
    expect(buildSuggestions('localhost:5173', { tabs: [], activeTabId: null, history: [], searchUrl: SEARCH })[0]).toEqual({ kind: 'open', url: 'http://localhost:5173' })
  })
  it('offers open tabs, then history ranked by match', () => {
    const s = buildSuggestions('git', { tabs: [tab('a', 'https://gitlab.com/x', 'GitLab'), tab('b', 'https://example.com', 'Ex')], activeTabId: 'b', history, searchUrl: SEARCH })
    expect(s.map((x) => x.kind)).toEqual(['search', 'tab', 'history', 'history'])
    expect(s[2]).toMatchObject({ url: 'https://github.com/vastsa/PI-Desktop' })
  })
  it('returns nothing for empty input', () => {
    expect(buildSuggestions('  ', { tabs: [], activeTabId: null, history, searchUrl: SEARCH })).toEqual([])
  })
})

describe('recordVisit', () => {
  it('moves revisits to the front and counts them; ignores non-web pages', () => {
    let h = recordVisit([], 'https://a.com/', 'A', 1)
    h = recordVisit(h, 'https://b.com/', 'B', 2)
    h = recordVisit(h, 'https://a.com/', '', 3)
    expect(h.map((e) => [e.url, e.visits, e.title])).toEqual([['https://a.com/', 2, 'A'], ['https://b.com/', 1, 'B']])
    expect(recordVisit(h, 'about:blank', '')).toBe(h)
  })
})

describe('fitViewport', () => {
  it('follows the panel in fit mode', () => {
    expect(fitViewport({ kind: 'fit' }, { width: 500, height: 400 })).toEqual({ width: 500, height: 400, left: 0, top: 0, zoom: 1 })
  })
  it('scales a larger fixed viewport down and centres it', () => {
    const f = fitViewport({ kind: 'fixed', width: 1280, height: 800 }, { width: 640, height: 800 })
    expect(f).toEqual({ width: 640, height: 400, left: 0, top: 200, zoom: 0.5 })
  })
  it('never scales up', () => {
    expect(fitViewport({ kind: 'fixed', width: 400, height: 300 }, { width: 1000, height: 1000 }).zoom).toBe(1)
  })
  it('clamps sizes', () => {
    expect(clampViewport(10, 99999)).toEqual({ width: 320, height: 2400 })
  })
})
