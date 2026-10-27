import { create } from 'zustand'

/** One open file in the main-column editor strip. */
export interface EditorDoc {
  id: string
  workspace: string
  rel: string
  name: string
  line?: number
}

interface EditorState {
  docs: EditorDoc[]
  /** Active file tab; null means the chat of the pane is showing. */
  activeId: string | null
  open: (doc: Omit<EditorDoc, 'id'>) => void
  activate: (id: string | null) => void
  close: (id: string) => void
  renameRel: (oldRel: string, newRel: string, name: string) => void
  reorder: (fromId: string, toId: string) => void
  reset: () => void
}

const docId = (workspace: string, rel: string) => `${workspace}::${rel}`

export const useEditorStore = create<EditorState>((set, get) => ({
  docs: [],
  activeId: null,
  open: (doc) => {
    const id = docId(doc.workspace, doc.rel)
    const existing = get().docs.find((d) => d.id === id)
    if (existing) {
      // Always hand back a fresh object: re-clicking a citation must re-reveal its line.
      set({ activeId: id, docs: get().docs.map((d) => (d.id === id ? { ...d, line: doc.line } : d)) })
      return
    }
    set({ docs: [...get().docs, { ...doc, id }], activeId: id })
  },
  activate: (id) => set({ activeId: id && get().docs.some((d) => d.id === id) ? id : null }),
  close: (id) => {
    const docs = get().docs
    const index = docs.findIndex((d) => d.id === id)
    if (index < 0) return
    const next = docs.filter((d) => d.id !== id)
    const wasActive = get().activeId === id
    const fallback = next[Math.min(index, next.length - 1)]?.id ?? null
    set({ docs: next, activeId: wasActive ? fallback : get().activeId })
  },
  renameRel: (oldRel, newRel, name) => {
    const activeId = get().activeId
    const renamed = get().docs.find((d) => d.rel === oldRel)
    set({
      docs: get().docs.map((d) => (d.rel === oldRel ? { ...d, id: docId(d.workspace, newRel), rel: newRel, name } : d)),
      activeId: renamed && activeId === renamed.id ? docId(renamed.workspace, newRel) : activeId,
    })
  },
  reorder: (fromId, toId) => {
    const docs = [...get().docs]
    const from = docs.findIndex((d) => d.id === fromId)
    const to = docs.findIndex((d) => d.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = docs.splice(from, 1)
    docs.splice(to, 0, moved)
    set({ docs })
  },
  reset: () => set({ docs: [], activeId: null }),
}))
