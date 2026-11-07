import { describe, expect, it } from 'vitest'
import {
  DRAFT_CAPABILITY_KEY,
  adoptDraftCapabilities,
  currentSessionCapabilities,
  onCapabilityKeyChange,
  setSessionCapability,
  toggleCapabilityIn,
  useSessionCapabilitiesStore,
} from './session-capabilities'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { useUIStore } from '@renderer/stores/ui-store'

describe('session capabilities', () => {
  it('switches capabilities per session and drops empty lists (default off)', () => {
    let byKey = toggleCapabilityIn({}, '/a.jsonl', 'pi-ui', true)
    byKey = toggleCapabilityIn(byKey, '/a.jsonl', 'pi-ui', true)
    expect(byKey).toEqual({ '/a.jsonl': ['pi-ui'] })
    expect(byKey['/b.jsonl']).toBeUndefined()
    expect(toggleCapabilityIn(byKey, '/a.jsonl', 'pi-ui', false)).toEqual({})
  })

  it('moves draft switches to the new session once', () => {
    const byKey = { [DRAFT_CAPABILITY_KEY]: ['pi-ui' as const] }
    expect(adoptDraftCapabilities(byKey, '/new.jsonl')).toEqual({ '/new.jsonl': ['pi-ui'] })
    expect(adoptDraftCapabilities({ ...byKey, '/new.jsonl': ['browser' as const] }, '/new.jsonl')).toBeNull()
    expect(adoptDraftCapabilities({}, '/new.jsonl')).toBeNull()
  })

  it('keeps draft switches only for the session the draft just became', () => {
    useUIStore.setState({ historySessionFile: null })
    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['pi-ui'] } })
    // Switching to an unrelated session drops the draft switches.
    onCapabilityKeyChange(DRAFT_CAPABILITY_KEY, '/other.jsonl', Date.now() + 60_000)
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({})

    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['pi-ui'] } })
    expect(currentSessionCapabilities()).toEqual(['pi-ui'])
    onCapabilityKeyChange(DRAFT_CAPABILITY_KEY, '/new.jsonl')
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({ '/new.jsonl': ['pi-ui'] })
  })

  it('hands draft switches to the session file created while sending', () => {
    useSessionCapabilitiesStore.setState({ byKey: { [DRAFT_CAPABILITY_KEY]: ['browser'] } })
    useUIStore.setState({ historySessionFile: '/created-on-send.jsonl' })
    expect(currentSessionCapabilities()).toEqual(['browser'])
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({ '/created-on-send.jsonl': ['browser'] })
    useUIStore.setState({ historySessionFile: null })
  })

  it('auto-attaches built-in browser capability when the session already has browser tabs unless explicitly turned off', () => {
    useSessionCapabilitiesStore.setState({ byKey: {} })
    useUIStore.setState({ historySessionFile: '/with-tab.jsonl' })
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
          openedBy: { sessionKey: '/with-tab.jsonl' },
        },
      },
      order: ['t1'],
      activeTabId: 't1',
    })
    expect(currentSessionCapabilities()).toEqual(['browser'])

    // Unrelated session without tabs stays off
    useUIStore.setState({ historySessionFile: '/no-tab.jsonl' })
    expect(currentSessionCapabilities()).toEqual([])

    // Explicit off in /with-tab.jsonl is respected
    useUIStore.setState({ historySessionFile: '/with-tab.jsonl' })
    setSessionCapability('/with-tab.jsonl', 'browser', false)
    expect(currentSessionCapabilities()).toEqual([])

    useBrowserStore.setState({ tabs: {}, order: [], activeTabId: null })
    useUIStore.setState({ historySessionFile: null })
  })
})
