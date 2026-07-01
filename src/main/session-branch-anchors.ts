import { readFileSync, existsSync } from 'fs'

export type BranchAnchor = {
  entryId: string
  role: 'user' | 'assistant'
  preview: string
  timestamp: string
}

function textFromMessage(msg: any): string {
  const c = msg?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => p.text || '')
    .join('')
}

/** Walk JSONL session file in file order; collect message entry ids on current branch path is hard without leaf — use all message entries in order for anchor matching by index. */
export function listMessageAnchorsFromSessionFile(sessionFile: string): BranchAnchor[] {
  if (!sessionFile || !existsSync(sessionFile)) return []
  let raw: string
  try {
    raw = readFileSync(sessionFile, 'utf-8')
  } catch {
    return []
  }
  const anchors: BranchAnchor[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type !== 'message' || !e.id || !e.message) continue
    const role = e.message.role
    if (role !== 'user' && role !== 'assistant') continue
    const preview = textFromMessage(e.message).trim().slice(0, 120)
    anchors.push({
      entryId: e.id,
      role,
      preview: preview || `(${role})`,
      timestamp: e.timestamp || '',
    })
  }
  return anchors
}