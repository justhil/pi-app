const STORAGE_KEY = 'pi-desktop:review-inline-comments:v1'

export type ReviewInlineComment = {
  id: string
  filePath: string
  hunkIndex: number
  lineIndex: number
  text: string
  createdAt: number
}

type Store = Record<string, ReviewInlineComment[]>

function scopeKey(cwd: string): string {
  return cwd.replace(/\\/g, '/')
}

function loadAll(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Store
  } catch {
    return {}
  }
}

function saveAll(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function listReviewComments(cwd: string, filePath: string): ReviewInlineComment[] {
  const key = scopeKey(cwd)
  return (loadAll()[key] || []).filter((c) => c.filePath === filePath)
}

export function listAllReviewComments(cwd: string): ReviewInlineComment[] {
  return loadAll()[scopeKey(cwd)] || []
}

export function upsertReviewComment(
  cwd: string,
  input: Omit<ReviewInlineComment, 'id' | 'createdAt'> & { id?: string },
): ReviewInlineComment {
  const key = scopeKey(cwd)
  const store = loadAll()
  const list = store[key] || []
  const row: ReviewInlineComment = {
    id: input.id || `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filePath: input.filePath,
    hunkIndex: input.hunkIndex,
    lineIndex: input.lineIndex,
    text: input.text,
    createdAt: Date.now(),
  }
  const idx = list.findIndex((c) => c.id === row.id)
  if (idx >= 0) list[idx] = row
  else list.push(row)
  store[key] = list
  saveAll(store)
  return row
}

export function deleteReviewComment(cwd: string, id: string): void {
  const key = scopeKey(cwd)
  const store = loadAll()
  store[key] = (store[key] || []).filter((c) => c.id !== id)
  saveAll(store)
}