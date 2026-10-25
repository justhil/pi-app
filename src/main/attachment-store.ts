import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { sqliteIndex } from './sqlite-index'

/**
 * Clipboard images live in `clipboard-images/` under a uuid name and are pruned after 7 days, so a
 * sent message only keeps a path that eventually points at nothing. Persisting copies those bytes
 * once into `attachments/<sha256>.<ext>` and records where they came from, so history keeps
 * rendering after the temp file is gone.
 *
 * Content addressing means the same image pasted ten times costs one file; the rows are the only
 * thing that grows per paste, and deleting a session's rows lets the sweep collect the bytes.
 */

const SAFE_EXT = /^[a-z0-9]{1,8}$/i

export function resolveAttachmentBlobDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function blobPath(hash: string, ext: string): string {
  const safe = SAFE_EXT.test(ext) ? ext.toLowerCase() : 'bin'
  return join(resolveAttachmentBlobDir(), `${hash}.${safe}`)
}

/** Copy `sourcePath` into the content-addressed store and remember the mapping. Returns the blob path. */
export function persistAttachment(sourcePath: string, sessionFile?: string): string | null {
  try {
    if (!existsSync(sourcePath)) {
      // Already persisted (a rewind, a queued send): the row points at the surviving blob.
      return resolveStoredAttachment(sourcePath)
    }
    const bytes = readFileSync(sourcePath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const target = blobPath(hash, extname(sourcePath).replace(/^\./, ''))
    if (!existsSync(target)) writeFileSync(target, bytes)
    sqliteIndex.upsertAttachment(sourcePath, target, sessionFile)
    return target
  } catch {
    return null
  }
}

/** Blob path recorded for a temp path, if the file still exists. */
export function resolveStoredAttachment(sourcePath: string): string | null {
  const row = sqliteIndex.findAttachment(sourcePath) ?? sqliteIndex.findAttachmentLike(sourcePath)
  if (!row) return null
  return existsSync(row.path) ? row.path : null
}

/**
 * Persist every attachment a prompt carried. Runs from the send handler, after the worker accepted
 * the turn, so the text the agent receives is untouched — persistence is invisible to the prompt.
 */
export function persistAttachments(paths: readonly string[] | undefined, sessionFile?: string): number {
  let count = 0
  for (const raw of paths ?? []) {
    const path = String(raw ?? '').trim()
    if (!path || !existsSync(path)) continue
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue
    }
    if (persistAttachment(path, sessionFile)) count++
  }
  return count
}

/** Drop the blobs nothing references any more. Safe to call on startup and after a session delete. */
export function sweepAttachments(): number {
  let removed = 0
  try {
    const referenced = new Set(sqliteIndex.attachmentBlobPaths())
    for (const name of readdirSync(resolveAttachmentBlobDir())) {
      const full = join(resolveAttachmentBlobDir(), name)
      if (referenced.has(full)) continue
      try {
        unlinkSync(full)
        removed++
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir missing */
  }
  return removed
}
