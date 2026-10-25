import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'pi-attachment-profile-'))
// Stands in for `~/.pi/agent`: shared by every install, unlike the Electron profile.
const agentRoot = mkdtempSync(join(tmpdir(), 'pi-attachment-agent-'))

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../agent-dir', () => ({ resolveActiveAgentDir: () => agentRoot }))

// better-sqlite3 is a native addon built for Electron's ABI, so the index is stubbed with a Map.
const rows = new Map<string, { path: string; session_file?: string }>()
vi.mock('../sqlite-index', () => ({
  sqliteIndex: {
    upsertAttachment: (source: string, path: string, session?: string) =>
      rows.set(source, { path, session_file: session }),
    findAttachment: (source: string) => rows.get(source) ?? null,
    attachmentBlobPaths: () => [...new Set([...rows.values()].map((r) => r.path))],
    attachmentBlobPathsForSession: (session: string) =>
      [...new Set([...rows.values()].filter((r) => r.session_file === session).map((r) => r.path))],
    deleteAttachmentsForSession: (session: string) => {
      for (const [k, v] of rows) if (v.session_file === session) rows.delete(k)
    },
  },
}))

const { persistAttachment, persistAttachments, resolveStoredAttachment, deleteSessionAttachments, sweepAttachments } =
  await import('../attachment-store')

const blobDir = join(agentRoot, 'attachments')

function tempImage(name: string, bytes = 'png-bytes'): string {
  const dir = join(userData, 'clipboard-images')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

describe('attachment store', () => {
  it('stores blobs in the agent dir, not the Electron profile', () => {
    rows.clear()
    const path = tempImage('pi-clipboard-shared.png', 'shared-bytes')
    const stored = persistAttachment(path, 's1.jsonl')

    expect(stored?.startsWith(blobDir)).toBe(true)
    expect(readdirSync(blobDir).length).toBeGreaterThan(0)
    expect(existsSync(join(userData, 'attachments'))).toBe(false)
  })

  it('keeps one blob per source path, so the same image from two paths stays independent', () => {
    rows.clear()
    const a = tempImage('pi-clipboard-a.png', 'same-bytes')
    const b = tempImage('pi-clipboard-b.png', 'same-bytes')
    const pathA = persistAttachment(a, 's2.jsonl')
    const pathB = persistAttachment(b, 's2.jsonl')

    expect(pathA).not.toBe(pathB)
    expect(rows.size).toBe(2)
  })

  it('resolves the persisted copy after the temp file is pruned', () => {
    rows.clear()
    const path = tempImage('pi-clipboard-pruned.png', 'pruned-later')
    const stored = persistAttachment(path, 's3.jsonl')
    unlinkSync(path)

    expect(resolveStoredAttachment(path)).toBe(stored)
    expect(readFileSync(stored!, 'utf8')).toBe('pruned-later')
  })

  it('resolves from the path alone, with no index row — the cross-install case', () => {
    rows.clear()
    const path = tempImage('pi-clipboard-other-profile.png', 'other-profile')
    const stored = persistAttachment(path, 's4.jsonl')
    rows.clear()
    unlinkSync(path)

    expect(resolveStoredAttachment(path)).toBe(stored)
  })

  it('persists every path the composer attached, whatever brought it in', () => {
    rows.clear()
    const pasted = tempImage('pi-clipboard-from-paste.png', 'from-clipboard')
    const picked = join(userData, 'Downloads', 'K DP.png')
    mkdirSync(join(userData, 'Downloads'), { recursive: true })
    writeFileSync(picked, 'from-picker')

    const count = persistAttachments([pasted, picked, join(userData, 'missing.png')], 's5.jsonl')

    expect(count).toBe(2)
    expect(resolveStoredAttachment(pasted)).not.toBeNull()
    expect(resolveStoredAttachment(picked)).not.toBeNull()
  })

  it('moves a blob from the pre-shared profile layout into the shared store', () => {
    rows.clear()
    const path = tempImage('pi-clipboard-legacy.png', 'legacy-bytes')
    const legacyDir = join(userData, 'attachments')
    mkdirSync(legacyDir, { recursive: true })
    const legacyBlob = join(legacyDir, 'deadbeef.png')
    writeFileSync(legacyBlob, 'legacy-bytes')
    rows.set(path, { path: legacyBlob, session_file: 's6.jsonl' })

    const resolved = resolveStoredAttachment(path)
    expect(resolved?.startsWith(blobDir)).toBe(true)
    expect(readFileSync(resolved!, 'utf8')).toBe('legacy-bytes')
  })

  it('deletes a session\'s blobs, keeping ones another session still uses', () => {
    rows.clear()
    const shared = tempImage('pi-clipboard-shared-src.png', 'both-sessions')
    const onlyHere = tempImage('pi-clipboard-own.png', 'one-session')
    const sharedBlob = persistAttachment(shared, 'gone.jsonl')
    const ownBlob = persistAttachment(onlyHere, 'gone.jsonl')
    persistAttachment(shared, 'kept.jsonl')

    deleteSessionAttachments('gone.jsonl')

    expect(existsSync(sharedBlob!)).toBe(true)
    expect(existsSync(ownBlob!)).toBe(false)
  })

  it('sweeps the old profile layout only, leaving the shared store untouched', () => {
    rows.clear()
    const legacyDir = join(userData, 'attachments')
    mkdirSync(legacyDir, { recursive: true })
    const orphan = join(legacyDir, 'orphan.png')
    writeFileSync(orphan, 'nobody-points-here')
    const sharedBlob = persistAttachment(tempImage('pi-clipboard-kept.png', 'kept'), 's7.jsonl')

    expect(sweepAttachments()).toBeGreaterThanOrEqual(1)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(sharedBlob!)).toBe(true)
  })
})
