import { describe, expect, it } from 'vitest'
import {
  DRAFT_CAPABILITY_KEY,
  adoptDraftCapabilities,
  currentSessionCapabilities,
  onCapabilityKeyChange,
  toggleCapabilityIn,
  useSessionCapabilitiesStore,
} from './session-capabilities'
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
})
