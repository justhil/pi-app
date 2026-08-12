import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshSessionTree } from '../rewind-metadata'
import { useUIStore } from '@renderer/stores/ui-store'

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void }
const pending: Deferred[] = []

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn(
      () =>
        new Promise((resolve, reject) =>
          pending.push({ resolve, reject: reject as (e: unknown) => void }),
        ),
    ),
  },
}))

describe('refreshSessionTree concurrency guard', () => {
  beforeEach(() => {
    pending.length = 0
    useUIStore.setState({
      rewindKey: '',
      rewindLoadingTree: false,
      rewindTreeError: undefined,
    })
    useUIStore.getState().setRewindMeta({ treeNodes: [], workerBound: false })
  })

  it('a stale response does not overwrite a newer tree for the same session', async () => {
    const p1 = refreshSessionTree('/s.jsonl')
    const p2 = refreshSessionTree('/s.jsonl')
    expect(pending.length).toBe(2)

    // The later request resolves first with the newest file snapshot.
    pending[1].resolve({ nodes: [{ id: 'n2', entryType: 'message', role: 'user', isLeaf: true }] })
    await p2
    expect(useUIStore.getState().rewindTreeNodes).toEqual([
      { id: 'n2', entryType: 'message', role: 'user', isLeaf: true },
    ])

    // The earlier request resolves afterwards with a stale snapshot: must be dropped.
    pending[0].resolve({ nodes: [{ id: 'n1', entryType: 'message', role: 'user', isLeaf: true }] })
    await p1
    expect(useUIStore.getState().rewindTreeNodes).toEqual([
      { id: 'n2', entryType: 'message', role: 'user', isLeaf: true },
    ])
    expect(useUIStore.getState().rewindLoadingTree).toBe(false)
  })

  it('an error from a stale request does not clear the current tree', async () => {
    const p1 = refreshSessionTree('/s.jsonl')
    const p2 = refreshSessionTree('/s.jsonl')

    pending[1].resolve({ nodes: [{ id: 'n2', entryType: 'message', isLeaf: false }] })
    await p2

    pending[0].reject(new Error('stale read failed'))
    await p1.catch(() => {})
    expect(useUIStore.getState().rewindTreeNodes).toEqual([
      { id: 'n2', entryType: 'message', isLeaf: false },
    ])
    expect(useUIStore.getState().rewindTreeError).toBeUndefined()
  })

  it('switching to another session invalidates an in-flight refresh', async () => {
    const p1 = refreshSessionTree('/a.jsonl')
    refreshSessionTree('/b.jsonl')

    pending[1].resolve({ nodes: [{ id: 'b1', entryType: 'message', isLeaf: true }] })
    // wait for the second request to settle
    await Promise.resolve()
    await Promise.resolve()

    pending[0].resolve({ nodes: [{ id: 'a1', entryType: 'message', isLeaf: true }] })
    await p1
    expect(useUIStore.getState().rewindTreeNodes).toEqual([
      { id: 'b1', entryType: 'message', isLeaf: true },
    ])
    expect(useUIStore.getState().rewindKey).toBe('/b.jsonl')
  })

  it('switching to no session invalidates an in-flight refresh and clears the store', async () => {
    const p1 = refreshSessionTree('/a.jsonl')
    // 切到无会话：序号递增，A 的在途响应必须失效并清空树
    refreshSessionTree(null)
    expect(useUIStore.getState().rewindTreeNodes).toEqual([])
    expect(useUIStore.getState().rewindKey).toBe('')

    pending[0].resolve({ nodes: [{ id: 'a1', entryType: 'message', isLeaf: true }] })
    await p1
    expect(useUIStore.getState().rewindTreeNodes).toEqual([])
    expect(useUIStore.getState().rewindKey).toBe('')
  })
})
