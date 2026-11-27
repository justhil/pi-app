// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import { buildSuggestions } from '../address-suggestions'
import { sendToComposer } from '../browser-composer'
import { useBrowserStore } from '../browser-store'
import { BrowserPanel } from '../browser-panel'
import { overlayCovers } from '../use-view-placement'

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invokeMock(...args) },
  onBrowserEvent: () => () => {},
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (k: string) => k }),
  }
})

afterEach(() => {
  cleanup()
  invokeMock.mockReset()
  useUIStore.setState({ browserChatExpand: false, activePanel: 'browser', rightPanelCollapsed: false })
  useRightDockStore.setState({ bottomTabIds: [], topActive: 'browser', bottomActive: null })
  useBrowserStore.setState({
    tabs: {},
    order: [],
    activeTabId: null,
    bookmarks: [],
    agentAction: null,
    agentSteps: [],
    hydrated: true,
  })
})

describe('RightDock Browser Panel, Omnibox & HUD polish', () => {
  it('remembers separate spacious rightPanelBrowserWidth (580px) vs regular rightPanelWidth (360px) and exits full-chat expand on sendToComposer', () => {
    expect(useUIStore.getState().rightPanelBrowserWidth).toBe(580)
    useUIStore.setState({ browserChatExpand: true })
    sendToComposer({ text: 'Inspect this element' })
    expect(useUIStore.getState().browserChatExpand).toBe(false)
  })

  it('merges open tabs, bookmarks, dev servers, and history in unified Omnibox suggestions', () => {
    const list = buildSuggestions('vite', {
      tabs: [],
      activeTabId: null,
      bookmarks: [{ id: '1', title: 'Vite Guide', url: 'https://vitejs.dev/guide', folder: '', createdAt: 1 }],
      devServers: [{ url: 'http://localhost:5173', label: 'Vite (:5173)' }],
      history: [{ url: 'https://vitest.dev', title: 'Vitest', visits: 3, lastAt: 100 }],
      searchUrl: 'https://www.bing.com/search?q=',
    })
    expect(list.map((s) => s.kind)).toEqual(['search', 'bookmark', 'devserver', 'history'])
  })

  it('detects live-theme-studio, shell-popover, and resizing shield in overlayCovers', () => {
    const target = document.createElement('div')
    target.getBoundingClientRect = () => ({ left: 500, top: 80, right: 1200, bottom: 800, width: 700, height: 720, x: 500, y: 80, toJSON: () => ({}) })
    const studio = document.createElement('div')
    studio.className = 'live-theme-studio'
    studio.getBoundingClientRect = () => ({ left: 900, top: 100, right: 1250, bottom: 600, width: 350, height: 500, x: 900, y: 100, toJSON: () => ({}) })
    document.body.append(target, studio)

    expect(overlayCovers(target)).toBe(true)
    studio.remove()
    expect(overlayCovers(target)).toBe(false)

    document.body.setAttribute('data-browser-resizing', 'true')
    expect(overlayCovers(target)).toBe(true)
    document.body.removeAttribute('data-browser-resizing')
    target.remove()
  })

  it('renders live Agent Progress HUD outside the native WebContentsView viewport rect', () => {
    useBrowserStore.setState({
      tabs: {
        t1: {
          tabId: 't1',
          engine: 'electron',
          profileId: 'default-electron',
          url: 'https://example.com',
          title: 'Example',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          openedBy: 'user',
        },
      },
      order: ['t1'],
      activeTabId: 't1',
      agentAction: { tabId: 't1', action: 'click #save' },
      agentSteps: [{ id: 's1', tabId: 't1', action: 'click #save', status: 'running', at: Date.now() }],
      hydrated: true,
    })

    const { container } = render(<BrowserPanel />)
    const hud = container.querySelector('[data-pi-slot="browser-agent-hud"]')
    const viewport = container.querySelector('[data-browser-viewport]')
    expect(hud).toBeInTheDocument()
    expect(viewport?.contains(hud)).toBe(false)
    expect(screen.getByText('agent.takeover')).toBeInTheDocument()
  })
})
