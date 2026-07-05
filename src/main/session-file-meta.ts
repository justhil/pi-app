import { existsSync, readFileSync } from 'fs'

export function readSessionIdFromFile(sessionFile: string): string | null {
  if (!sessionFile || !existsSync(sessionFile)) return null
  try {
    const first = readFileSync(sessionFile, 'utf-8').split('\n').find((l) => l.trim())
    if (!first) return null
    const h = JSON.parse(first)
    if (h?.type === 'session' && h.id) return String(h.id)
  } catch (e) {
    return null
  }
  return null
}