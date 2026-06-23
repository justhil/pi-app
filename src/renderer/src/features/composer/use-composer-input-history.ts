import { useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'pi-desktop-composer-sent-history'
const MAX_ENTRIES = 200

type HistoryStore = Record<string, string[]>

function loadStore(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as HistoryStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveStore(store: HistoryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota */
  }
}

function scopeKey(workspace: string | null, sessionId: string | null): string {
  const w = workspace || '_none'
  const s = sessionId || '_none'
  return `${w}\0${s}`
}

/** 编辑器光标位置适配器，兼容富文本 contenteditable。 */
export interface EditorCursorAdapter {
  getValue(): string
  isEmpty(): boolean
  isCaretAtStart(): boolean
  isCaretAtEnd(): boolean
  isAllSelected(): boolean
  selectAll(): void
}

function canArrowUp(a: EditorCursorAdapter): boolean {
  if (a.isEmpty()) return true
  return a.isCaretAtStart() || a.isAllSelected()
}

function canArrowDown(a: EditorCursorAdapter): boolean {
  if (a.isEmpty()) return true
  return a.isCaretAtEnd() || a.isAllSelected()
}

export function useComposerInputHistory(
  workspace: string | null,
  sessionId: string | null,
  setText: (v: string) => void,
) {
  const historyRef = useRef<string[]>([])
  const navIndexRef = useRef(-1)
  /** 离开输入或进入历史前暂存的当前草稿（不按字更新） */
  const draftRef = useRef('')

  const reloadHistory = useCallback(() => {
    const key = scopeKey(workspace, sessionId)
    const store = loadStore()
    historyRef.current = store[key] ? [...store[key]] : []
    navIndexRef.current = -1
  }, [workspace, sessionId])

  useEffect(() => {
    reloadHistory()
  }, [reloadHistory])

  const resetNav = useCallback(() => {
    navIndexRef.current = -1
  }, [])

  const persistDraft = useCallback((value: string) => {
    draftRef.current = value
  }, [])

  const recordSent = useCallback(
    (payload: string) => {
      const trimmed = payload.trim()
      if (!trimmed) return
      const key = scopeKey(workspace, sessionId)
      const store = loadStore()
      let list = [...(store[key] || [])]
      if (list[list.length - 1] !== trimmed) list.push(trimmed)
      if (list.length > MAX_ENTRIES) list = list.slice(-MAX_ENTRIES)
      store[key] = list
      saveStore(store)
      historyRef.current = list
      draftRef.current = ''
      resetNav()
    },
    [workspace, sessionId, resetNav],
  )

  const onComposerBlur = useCallback(
    (currentText: string) => {
      if (navIndexRef.current === -1) persistDraft(currentText)
    },
    [persistDraft],
  )

  const onUserEdit = useCallback(() => {
    if (navIndexRef.current !== -1) resetNav()
  }, [resetNav])

  const tryArrowUp = useCallback(
    (adapter: EditorCursorAdapter): boolean => {
      if (!canArrowUp(adapter)) return false
      const history = historyRef.current
      if (history.length === 0) return false

      if (navIndexRef.current === -1) {
        persistDraft(adapter.getValue())
        navIndexRef.current = 0
      } else if (navIndexRef.current < history.length - 1) {
        navIndexRef.current += 1
      } else {
        return true
      }
      const entry = history[history.length - 1 - navIndexRef.current]
      setText(entry ?? '')
      requestAnimationFrame(() => adapter.selectAll())
      return true
    },
    [setText, persistDraft],
  )

  const tryArrowDown = useCallback(
    (adapter: EditorCursorAdapter): boolean => {
      if (navIndexRef.current === -1) return false
      if (!canArrowDown(adapter)) return false

      if (navIndexRef.current > 0) {
        navIndexRef.current -= 1
        const history = historyRef.current
        const entry = history[history.length - 1 - navIndexRef.current]
        setText(entry ?? '')
      } else {
        navIndexRef.current = -1
        setText(draftRef.current)
      }
      requestAnimationFrame(() => adapter.selectAll())
      return true
    },
    [setText],
  )

  return { recordSent, tryArrowUp, tryArrowDown, onUserEdit, onComposerBlur, resetNav }
}