import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'

const REV_ROOT = join(homedir(), '.pi', 'agent', 'desktop-revisions')

export type RevisionEntry = {
  id: string
  at: number
  label: string
  hash: string
}

function revDir(filePath: string) {
  const h = createHash('sha256').update(filePath).digest('hex').slice(0, 24)
  return join(REV_ROOT, h)
}

function metaPath(filePath: string) {
  return join(revDir(filePath), 'meta.json')
}

function snapPath(filePath: string, id: string) {
  return join(revDir(filePath), `${id}.md`)
}

export function listRevisions(filePath: string): RevisionEntry[] {
  const mp = metaPath(filePath)
  if (!existsSync(mp)) return []
  try {
    const list = JSON.parse(readFileSync(mp, 'utf-8')) as RevisionEntry[]
    return Array.isArray(list) ? list.sort((a, b) => b.at - a.at) : []
  } catch {
    return []
  }
}

export function pushRevision(filePath: string, label = '保存前'): RevisionEntry | null {
  if (!existsSync(filePath)) return null
  const content = readFileSync(filePath, 'utf-8')
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12)
  const id = `${Date.now()}-${hash}`
  const dir = revDir(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(snapPath(filePath, id), content, 'utf-8')
  const entry: RevisionEntry = { id, at: Date.now(), label, hash }
  const next = [entry, ...listRevisions(filePath)].slice(0, 40)
  writeFileSync(metaPath(filePath), JSON.stringify(next, null, 2), 'utf-8')
  return entry
}

export function readRevision(filePath: string, revisionId: string): string {
  const p = snapPath(filePath, revisionId)
  if (!existsSync(p)) throw new Error('版本不存在')
  return readFileSync(p, 'utf-8')
}

export function restoreRevision(filePath: string, revisionId: string): void {
  const content = readRevision(filePath, revisionId)
  pushRevision(filePath, '回退前')
  writeFileSync(filePath, content, 'utf-8')
}

export function deleteRevision(filePath: string, revisionId: string): void {
  const p = snapPath(filePath, revisionId)
  if (existsSync(p)) unlinkSync(p)
  const next = listRevisions(filePath).filter((r) => r.id !== revisionId)
  const dir = revDir(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(metaPath(filePath), JSON.stringify(next, null, 2), 'utf-8')
}