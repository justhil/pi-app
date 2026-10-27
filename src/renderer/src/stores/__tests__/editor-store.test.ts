import { beforeEach, expect, it } from 'vitest'
import { useEditorStore } from '../editor-store'

const doc = (rel: string) => ({ workspace: '/ws', rel, name: rel.split('/').pop() ?? rel })

beforeEach(() => useEditorStore.getState().reset())

it('opens a doc and activates it', () => {
  useEditorStore.getState().open(doc('src/a.ts'))
  const s = useEditorStore.getState()
  expect(s.docs).toHaveLength(1)
  expect(s.activeId).toBe(s.docs[0].id)
})

it('reuses the tab for an already open file', () => {
  const { open } = useEditorStore.getState()
  open(doc('src/a.ts'))
  open(doc('src/b.ts'))
  open(doc('src/a.ts'))
  const s = useEditorStore.getState()
  expect(s.docs.map((d) => d.rel)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(s.docs.find((d) => d.id === s.activeId)?.rel).toBe('src/a.ts')
})

it('falls back to the neighbour tab when the active tab closes, then to chat', () => {
  const { open } = useEditorStore.getState()
  open(doc('src/a.ts'))
  open(doc('src/b.ts'))
  const [a, b] = useEditorStore.getState().docs
  useEditorStore.getState().close(a.id)
  expect(useEditorStore.getState().activeId).toBe(b.id)
  useEditorStore.getState().close(b.id)
  expect(useEditorStore.getState().activeId).toBeNull()
  expect(useEditorStore.getState().docs).toHaveLength(0)
})

it('renames the open tab and keeps it active', () => {
  const { open } = useEditorStore.getState()
  open(doc('src/a.ts'))
  useEditorStore.getState().renameRel('src/a.ts', 'src/b.ts', 'b.ts')
  const s = useEditorStore.getState()
  expect(s.docs[0]).toMatchObject({ rel: 'src/b.ts', name: 'b.ts' })
  expect(s.activeId).toBe(s.docs[0].id)
})

it('reorders tabs', () => {
  const { open } = useEditorStore.getState()
  open(doc('a.ts'))
  open(doc('b.ts'))
  const [a, b] = useEditorStore.getState().docs
  useEditorStore.getState().reorder(b.id, a.id)
  expect(useEditorStore.getState().docs.map((d) => d.rel)).toEqual(['b.ts', 'a.ts'])
})
