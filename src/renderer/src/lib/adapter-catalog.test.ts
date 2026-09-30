import { beforeEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./ipc-client', () => ({ ipcClient: { invoke } }))
import { activateAdapterWorkspace, currentAdapterCatalog, invalidateAdapterSnapshots, loadAdapterCatalog } from './adapter-catalog'
const catalog = (id: string) => ({ revision: id, adapters: [{ id, match: {}, tier: 'partial' }], errors: [], sources: {} })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(async () => { invoke.mockReset().mockResolvedValue(catalog('empty')); invalidateAdapterSnapshots(); await loadAdapterCatalog() })
describe('renderer adapter snapshots', () => {
  it('does not replace the active project with a late response from another project', async () => {
    const a = deferred<ReturnType<typeof catalog>>()
    invoke.mockImplementation((_method, request) => request.workspaceId === 'A' ? a.promise : Promise.resolve(catalog('B')))
    activateAdapterWorkspace('A')
    activateAdapterWorkspace('B')
    await loadAdapterCatalog('B')
    a.resolve(catalog('A'))
    await loadAdapterCatalog('A')
    expect(currentAdapterCatalog()[0]?.id).toBe('B')
  })
  it('ignores obsolete responses after runtime invalidation', async () => {
    const old = deferred<ReturnType<typeof catalog>>()
    invoke.mockReturnValueOnce(old.promise)
    const pending = loadAdapterCatalog('C')
    invoke.mockResolvedValue(catalog('fresh'))
    activateAdapterWorkspace('C')
    invalidateAdapterSnapshots()
    await loadAdapterCatalog('C')
    old.resolve(catalog('stale'))
    await pending
    expect(currentAdapterCatalog()[0]?.id).toBe('fresh')
  })
})
