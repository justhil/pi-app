import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({}) } }))

import { clearSessionScopesForTests, patchSessionState, removeSessionState, sessionStoreApi } from '../session-scope'
import { sessionKeyOf } from '../session-state'
import { useUIStore } from '../ui-store'

const FILE_A = '/w/.pi/sessions/a.jsonl'
const FILE_B = '/w/.pi/sessions/b.jsonl'
const item = (id: string) => ({ id, type: 'user-message' as const, text: id, timestamp: 1 })
let n = 0
const nextId = () => `id-${++n}`

describe('session-scope cleanup', () => {
  beforeEach(() => {
    clearSessionScopesForTests()
    useUIStore.setState({ sessionStates: {}, historySessionFile: FILE_B, currentWorkspace: '/w' })
  })

  it('removes a deleted session entry and its cached scope', () => {
    const key = sessionKeyOf(FILE_A)
    const api = sessionStoreApi(key, nextId)
    api.get().appendTimeline(item('x'))
    expect(useUIStore.getState().sessionStates[key]?.timelineItems).toHaveLength(1)

    removeSessionState(FILE_A)
    expect(useUIStore.getState().sessionStates[key]).toBeUndefined()
    expect(sessionStoreApi(key, nextId)).not.toBe(api)
  })

  it('drops late events for a deleted session instead of re-seeding it', () => {
    const key = sessionKeyOf(FILE_A)
    patchSessionState(key, { pendingSteering: ['a'] })
    removeSessionState(FILE_A)

    sessionStoreApi(key, nextId).get().appendTimeline(item('late'))
    patchSessionState(key, { pendingSteering: ['b'] })
    expect(useUIStore.getState().sessionStates[key]).toBeUndefined()
  })

  it('allowReseed lets a removed key come back', () => {
    const key = sessionKeyOf(FILE_A)
    patchSessionState(key, { pendingSteering: ['a'] })
    removeSessionState(FILE_A, { allowReseed: true })
    patchSessionState(key, { pendingSteering: ['b'] })
    expect(useUIStore.getState().sessionStates[key]?.pendingSteering).toEqual(['b'])
  })

  it('promoteViewSession drops the old draft entry', () => {
    useUIStore.setState({ historySessionFile: null, pendingNewSessionPlaceholder: true })
    const draftKey = useUIStore.getState().viewSessionKey!
    expect(draftKey.startsWith('draft:')).toBe(true)
    useUIStore.setState({ timelineItems: [item('d')] })
    expect(useUIStore.getState().sessionStates[draftKey]).toBeDefined()

    useUIStore.getState().promoteViewSession({ sessionId: 's1', sessionFile: FILE_A })
    const s = useUIStore.getState()
    expect(s.sessionStates[draftKey]).toBeUndefined()
    expect(s.sessionStates[sessionKeyOf(FILE_A)]?.timelineItems.map((i) => i.id)).toEqual(['d'])
  })

  it('promoteViewSession keeps a widget the new session published while it was created', () => {
    useUIStore.setState({ historySessionFile: null, pendingNewSessionPlaceholder: true })
    const widget = {
      adapterId: 'a', widgetKey: 'k', protocol: 'todo-list-v1' as const, title: 'Todo',
      payload: { items: [{ id: '1', text: 'From session_start', status: 'pending' as const }] }, updatedAt: 1,
    }
    // The background event for the not-yet-visible session lands in its own entry.
    sessionStoreApi(sessionKeyOf(FILE_A), nextId).get().setComposerWidget(widget)

    useUIStore.getState().promoteViewSession({ sessionId: 's1', sessionFile: FILE_A })
    expect(useUIStore.getState().composerWidget).toEqual(widget)
  })
})
