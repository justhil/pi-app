const KEY = 'pi-desktop:recent-models'
const LIMIT = 5

/** Recently picked models (`provider/id`), newest first. Per-viewer convenience; may be empty. */
export function readRecentModels(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, LIMIT) : []
  } catch {
    return []
  }
}

export function rememberRecentModel(model: string, current: readonly string[] = readRecentModels()): string[] {
  const next = [model, ...current.filter((m) => m !== model)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: recents simply stay empty */
  }
  return next
}
