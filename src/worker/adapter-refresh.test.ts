import { afterEach, describe, expect, it, vi } from 'vitest'
import { st, applyPendingAdapterCatalog } from './worker-runtime'
import { handleRefreshadapters } from './handlers/worker-handlers-catalog'
import { loadAdapterCatalog, invalidateAdapterCatalog } from '../extension-compat/adapter-loader'

afterEach(() => { st.pendingAdapterCatalog = null; st.agentTurnActive = false; st.currentCwd = ''; invalidateAdapterCatalog() })
describe('adapter snapshot updates', () => {
  it('defers display rules until the current turn ends without reloading Pi', async () => {
    st.currentCwd = '/adapter-test'
    st.agentTurnActive = true
    const catalog = { revision: 'new', adapters: [], errors: [], sources: {} }
    const reply = vi.fn()
    await handleRefreshadapters({ catalog }, reply)
    expect(st.pendingAdapterCatalog).toBe(catalog)
    expect(loadAdapterCatalog(st.currentCwd).revision).not.toBe('new')
    st.agentTurnActive = false
    applyPendingAdapterCatalog()
    expect(loadAdapterCatalog(st.currentCwd).revision).toBe('new')
    expect(st.pendingAdapterCatalog).toBeNull()
  })
})
