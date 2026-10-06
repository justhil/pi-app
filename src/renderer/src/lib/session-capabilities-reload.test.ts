import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke } }))

import { DRAFT_CAPABILITY_KEY, reloadSessionCapabilities, useSessionCapabilitiesStore } from './session-capabilities'

describe('reloadSessionCapabilities (a phone changed a switch)', () => {
  beforeEach(() => invoke.mockReset())

  it('replaces saved sessions with the stored map and keeps the in-memory draft', async () => {
    useSessionCapabilitiesStore.setState({
      byKey: { '/a.jsonl': ['pi-ui'], '/b.jsonl': ['browser'], [DRAFT_CAPABILITY_KEY]: ['browser'] },
      loaded: true,
    })
    invoke.mockResolvedValue({ settings: { sessionCapabilities: { '/b.jsonl': ['pi-ui', 'bogus'], '/c.jsonl': ['pi-ui'] } } })
    await reloadSessionCapabilities()
    expect(invoke).toHaveBeenCalledWith('settings.get', { key: 'sessionCapabilities' })
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({
      '/b.jsonl': ['pi-ui'],
      '/c.jsonl': ['pi-ui'],
      [DRAFT_CAPABILITY_KEY]: ['browser'],
    })
  })

  it('keeps the current map when the read fails', async () => {
    useSessionCapabilitiesStore.setState({ byKey: { '/a.jsonl': ['pi-ui'] }, loaded: true })
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'settings.get') throw new Error('offline')
      return {}
    })
    await reloadSessionCapabilities()
    expect(useSessionCapabilitiesStore.getState().byKey).toEqual({ '/a.jsonl': ['pi-ui'] })
  })
})
