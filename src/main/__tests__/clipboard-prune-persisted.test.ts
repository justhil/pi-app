import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'pi-clipboard-prune-'))

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../agent-dir', () => ({ resolveActiveAgentDir: () => join(userData, 'agent') }))

const rows = new Map<string, { path: string }>()
vi.mock('../sqlite-index', () => ({
  sqliteIndex: {
    upsertAttachment: (source: string, path: string) => rows.set(source, { path }),
    findAttachment: (source: string) => rows.get(source) ?? null,
    findAttachmentLike: (source: string) => rows.get(source) ?? null,
    attachmentBlobPaths: () => [...new Set([...rows.values()].map((r) => r.path))],
    deleteAttachmentsForSession: () => {},
  },
}))

const { pruneStaleClipboardImages, readRemoteAttachment } = await import('../clipboard-temp-images')
const { persistAttachment } = await import('../attachment-store')

describe('clipboard prune', () => {
  it('keeps a temp file that was persisted, and still reads its bytes back', () => {
    const dir = join(userData, 'clipboard-images')
    mkdirSync(dir, { recursive: true })
    const persisted = join(dir, 'pi-clipboard-sent.png')
    const loose = join(dir, 'pi-clipboard-loose.png')
    writeFileSync(persisted, 'sent-bytes')
    writeFileSync(loose, 'never-sent')
    persistAttachment(persisted, 's.jsonl')

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    utimesSync(persisted, old, old)
    utimesSync(loose, old, old)
    pruneStaleClipboardImages(7 * 24 * 60 * 60 * 1000)

    expect(readRemoteAttachment(persisted)?.bytes.toString()).toBe('sent-bytes')
    expect(readRemoteAttachment(loose)).toBeNull()
  })
})
