import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'pi-attachment-store-'))

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

// better-sqlite3 is a native addon built for Electron's ABI, so the index is stubbed with a Map.
const rows = new Map<string, { path: string; session_file?: string }>()
vi.mock('../sqlite-index', () => ({
  sqliteIndex: {
    upsertAttachment: (source: string, path: string, session?: string) => rows.set(source, { path, session_file: session }),
    findAttachment: (source: string) => rows.get(source) ?? null,
    attachmentBlobPaths: () => [...new Set([...rows.values()].map((r) => r.path))],
    deleteAttachmentsForSession: (session: string) => {
      for (const [k, v] of rows) if (v.session_file === session) rows.delete(k)
    },
  },
}))

const { persistAttachment, persistPromptAttachments, resolveStoredAttachment, sweepAttachments } = await import(
  '../attachment-store'
)

function tempImage(bytes = 'png-bytes'): string {
  const dir = join(userData, 'clipboard-images')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'pi-clipboard-test.png')
  writeFileSync(path, bytes === '' ? '' : bytes)
  return path
}

describe('attachment store', () => {
  it('copies bytes once per content hash and keeps a row per paste', () => {
    const a = tempImage('same-bytes')
    const b = join(userData, 'clipboard-images', 'pi-clipboard-second.png')
    writeFileSync(b, 'same-bytes')
    const pathA = persistAttachment(a, 's1.jsonl')
    const pathB = persistAttachment(b, 's1.jsonl')

    expect(pathA).toBe(pathB)
    expect(readdirSync(join(userData, 'attachments'))).toHaveLength(1)
    expect(rows.size).toBe(2)
  })

  it('resolves the persisted copy after the temp file is pruned', () => {
    const path = tempImage('pruned-later')
    const stored = persistAttachment(path, 's2.jsonl')
    unlinkSync(path)

    expect(resolveStoredAttachment(path)).toBe(stored)
    expect(readFileSync(stored!, 'utf8')).toBe('pruned-later')
  })

  it('persists every clipboard path found in the prompt text', () => {
    rows.clear()
    const path = tempImage('from-text')
    const count = persistPromptAttachments(`look at @${path} and reply`, 's3.jsonl')

    expect(count).toBe(1)
    expect(resolveStoredAttachment(path)).not.toBeNull()
  })

  it('sweeps blobs no row points at', () => {
    rows.clear()
    const kept = tempImage('kept')
    const keptBlob = persistAttachment(kept, 's4.jsonl')
    const orphan = join(userData, 'attachments', 'orphan.png')
    writeFileSync(orphan, 'nobody-points-here')

    expect(sweepAttachments()).toBeGreaterThanOrEqual(1)
    expect(existsSync(keptBlob!)).toBe(true)
    expect(existsSync(orphan)).toBe(false)
  })

  it('drops a session\'s rows so its blobs become collectable', () => {
    rows.clear()
    const path = join(userData, 'clipboard-images', 'pi-clipboard-dropped.png')
    mkdirSync(join(userData, 'clipboard-images'), { recursive: true })
    writeFileSync(path, 'session-scoped')
    const stored = persistAttachment(path, 'gone.jsonl')
    expect(resolveStoredAttachment(path)).toBe(stored)

    persistAttachment(path, 'gone.jsonl')
    rows.delete(path)
    sweepAttachments()

    expect(existsSync(stored!)).toBe(false)
  })
})
