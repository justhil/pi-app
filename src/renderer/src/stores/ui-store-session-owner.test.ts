import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({}) } }))
import { useUIStore } from './ui-store'

beforeEach(() => useUIStore.setState({ currentWorkspace: 'D:/B', sessions: [], sessionsWorkspace: null }))

describe('session list owner', () => {
  it('rejects a late list written by another project', () => {
    useUIStore.getState().setSessions([{ sessionId: 'A', title: 'old', updatedAt: 1, modelId: '' }], 'D:/A')
    expect(useUIStore.getState().sessions).toEqual([])
    expect(useUIStore.getState().sessionsWorkspace).toBeNull()
  })
  it('accepts normalized Windows paths and preserves empty owned results', () => {
    useUIStore.getState().setSessions([{ sessionId: 'B', title: 'current', updatedAt: 1, modelId: '' }], 'd:\\b\\')
    expect(useUIStore.getState().sessions[0]?.sessionId).toBe('B')
    useUIStore.getState().setSessions([], 'D:/B')
    expect(useUIStore.getState().sessionsWorkspace).toBe('D:/B')
    expect(useUIStore.getState().sessions).toEqual([])
  })
})
