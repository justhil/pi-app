import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  class FakeWebContents {
    id = Math.floor(Math.random() * 1e9)
    session = { cookies: { remove: vi.fn() } }
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
    on = vi.fn()
    setWindowOpenHandler = vi.fn()
    isDestroyed = () => false
    close = vi.fn()
    loadURL = vi.fn(async () => {})
    getURL = () => 'about:blank'
    getTitle = () => ''
    getUserAgent = () => 'ua'
    setUserAgent = vi.fn()
    setAudioMuted = vi.fn()
    reload = vi.fn()
  }
  class WebContentsView {
    webContents = new FakeWebContents()
    setVisible = vi.fn()
    setBounds = vi.fn()
    getBounds = () => ({ x: 0, y: 0, width: 100, height: 100 })
  }
  return { WebContentsView, shell: { openExternal: vi.fn() } }
})
vi.mock('../config-store', () => ({ configStore: { get: () => undefined } }))
vi.mock('./electron-session', () => ({
  configureBrowserSession: vi.fn(),
  partitionForProfile: () => 'persist:test',
  peekDownloadManager: () => null,
  userAgentForSessionUrl: () => 'ua',
}))
const engineState = vi.hoisted(() => ({ loadingPolls: 0, ranWhileLoading: [] as boolean[] }))
vi.mock('./engines/electron', () => ({
  ElectronPageEngine: class {
    isLoading() {
      if (engineState.loadingPolls > 0) {
        engineState.loadingPolls--
        return true
      }
      return false
    }
    async run() {
      engineState.ranWhileLoading.push(engineState.loadingPolls > 0)
      return { text: 'page' }
    }
  },
}))
vi.mock('./agent/input', () => ({ Pointer: class {} }))
vi.mock('./agent/tools', () => ({ adoptAgentSessionTabs: vi.fn(), forgetBrowserTab: vi.fn() }))

import { BrowserHost } from './browser-host'

function fakeWindow() {
  return {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1400, height: 900 }),
    getContentSize: () => [1400, 900],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { send: vi.fn(), getZoomFactor: () => 1 },
  }
}

describe('BrowserHost focus across conversations', () => {
  let host: BrowserHost

  beforeEach(() => {
    const win = fakeWindow()
    host = new BrowserHost(() => win as never)
    host.setSession('/sessions/a.jsonl')
  })

  it('keeps the visible tab when an agent in a background conversation opens one', () => {
    const userTab = host.openTab({ openedBy: 'user' })
    expect(host.list().activeTabId).toBe(userTab.tabId)

    host.openTab({ openedBy: { sessionKey: '/sessions/b.jsonl' } })

    expect(host.list().activeTabId).toBe(userTab.tabId)
  })

  it('keeps the visible tab when a background agent focuses its own tab', () => {
    host.setSession('/sessions/b.jsonl')
    const agentTab = host.openTab({ openedBy: { sessionKey: '/sessions/b.jsonl' } })
    host.setSession('/sessions/a.jsonl')
    host.focusTab(null)
    const userTab = host.openTab({ openedBy: 'user' })

    host.focusTab(agentTab.tabId, { sessionKey: '/sessions/b.jsonl' })

    expect(host.list().activeTabId).toBe(userTab.tabId)
  })

  it('still switches to a tab the agent of the visible conversation opens or focuses', () => {
    host.openTab({ openedBy: 'user' })
    const own = host.openTab({ openedBy: { sessionKey: '/sessions/a.jsonl' } })
    expect(host.list().activeTabId).toBe(own.tabId)

    const other = host.openTab({ openedBy: 'user' })
    host.focusTab(own.tabId, { sessionKey: '/sessions/a.jsonl' })
    expect(host.list().activeTabId).toBe(own.tabId)
    expect(other.tabId).not.toBe(own.tabId)
  })

  it('honours an explicit focus request and window focus from any conversation', () => {
    const userTab = host.openTab({ openedBy: 'user' })
    const forced = host.openTab({ openedBy: { sessionKey: '/sessions/b.jsonl' }, focus: true })
    expect(host.list().activeTabId).toBe(forced.tabId)

    host.focusTab(userTab.tabId)
    host.focusTab(forced.tabId, { sessionKey: '/sessions/b.jsonl', window: true })
    expect(host.list().activeTabId).toBe(forced.tabId)
  })
})

describe('BrowserHost sleeping tabs', () => {
  it('waits for a woken tab to load before reading its page context', async () => {
    const win = fakeWindow()
    const host = new BrowserHost(() => win as never)
    const background = host.openTab({ url: 'https://example.com/', openedBy: 'user' })
    host.openTab({ openedBy: 'user' })
    expect(host.sleepTab(background.tabId)?.sleeping).toBe(true)

    engineState.ranWhileLoading = []
    engineState.loadingPolls = 3
    await host.pageContext(background.tabId)

    expect(engineState.ranWhileLoading).toEqual([false])
    expect(engineState.loadingPolls).toBe(0)
  })
})
