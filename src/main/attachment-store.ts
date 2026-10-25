import { app } from 'electron'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join, normalize } from 'path'
import { resolveActiveAgentDir } from './agent-dir'
import { sqliteIndex } from './sqlite-index'

/**
 * Clipboard images live in `clipboard-images/` under a uuid name and are pruned after 7 days, so a
 * sent message only keeps a path that eventually points at nothing. Persisting copies those bytes
 * once into the shared attachment store and records where they came from, so history keeps
 * rendering after the temp file is gone.
 *
 * The store lives beside the sessions (`<agent dir>/attachments`) rather than in the Electron
 * profile, because the sessions are shared by every install that reads the same agent dir: a
 * picture sent from one build has to render in the other one. Blobs are named after the *source
 * path*, not their content, so any install can find the bytes from the path alone — no index
 * lookup, no shared database, and a wiped profile still resolves older messages.
 */

const SAFE_EXT = /^[a-z0-9]{1,8}$/i

/** Shared store: the same folder every install of the app resolves. */
export function resolveAttachmentBlobDir(): string {
  const dir = join(resolveActiveAgentDir(), 'attachments')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Pre-shared layout: blobs under the Electron profile, named by content hash. */
function legacyBlobDir(): string {
  return join(app.getPath('userData'), 'attachments')
}

/** Case- and separator-insensitive form of a path, as Windows treats it. */
function normalizeSource(sourcePath: string): string {
  const normalized = normalize(sourcePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function blobPathFor(sourcePath: string): string {
  const hash = createHash('sha256').update(normalizeSource(sourcePath)).digest('hex').slice(0, 32)
  const ext = extname(sourcePath).replace(/^\./, '')
  const safe = SAFE_EXT.test(ext) ? ext.toLowerCase() : 'bin'
  return join(resolveAttachmentBlobDir(), `${hash}.${safe}`)
}

/** Copy `sourcePath` into the shared store and remember the mapping. Returns the blob path. */
export function persistAttachment(sourcePath: string, sessionFile?: string): string | null {
  try {
    const target = blobPathFor(sourcePath)
    if (!existsSync(sourcePath)) {
      // Already persisted (a rewind, a queued send): the blob addressed by this path is the copy.
      return existsSync(target) ? target : resolveStoredAttachment(sourcePath)
    }
    if (!existsSync(target)) writeFileSync(target, readFileSync(sourcePath))
    sqliteIndex.upsertAttachment(sourcePath, target, sessionFile)
    return target
  } catch {
    return null
  }
}

/** Blob path for a temp path, if its bytes survive. Works without an index row. */
export function resolveStoredAttachment(sourcePath: string): string | null {
  const direct = blobPathFor(sourcePath)
  if (existsSync(direct)) return direct
  const row = sqliteIndex.findAttachment(sourcePath) ?? sqliteIndex.findAttachmentLike(sourcePath)
  if (!row) return null
  // A row from the pre-shared layout: move the bytes into the shared store while the file is here.
  if (row.path !== direct && existsSync(row.path)) {
    try {
      if (!existsSync(direct)) copyFileSync(row.path, direct)
      sqliteIndex.upsertAttachment(sourcePath, direct)
      return direct
    } catch {
      return row.path
    }
  }
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

/** Drop a deleted session's blobs that nothing else references. */
export function deleteSessionAttachments(sessionFile: string): number {
  let removed = 0
  const owned = sqliteIndex.attachmentBlobPathsForSession(sessionFile)
  sqliteIndex.deleteAttachmentsForSession(sessionFile)
  const stillReferenced = new Set(sqliteIndex.attachmentBlobPaths())
  for (const blob of owned) {
    if (stillReferenced.has(blob)) continue
    try {
      unlinkSync(blob)
      removed++
    } catch {
      /* already gone */
    }
  }
  return removed
}

/**
 * Move every blob this profile recorded before the store was shared into the shared store, so
 * pictures sent by an older build also render in any other install reading the same agent dir.
 */
export function migrateLegacyBlobs(): number {
  let moved = 0
  const legacy = legacyBlobDir()
  for (const row of sqliteIndex.attachmentPairs()) {
    if (!row.path.startsWith(legacy)) continue
    const target = blobPathFor(row.source_path)
    try {
      if (existsSync(target)) continue
      if (!existsSync(row.path)) continue
      copyFileSync(row.path, target)
      sqliteIndex.upsertAttachment(row.source_path, target)
      moved++
    } catch {
      /* unreadable source: the row keeps the old path until the next run */
    }
  }
  return moved
}

/**
 * Collect blobs the pre-shared layout left under this profile. The shared store is never swept:
 * another install may reference a blob this profile has no row for.
 */
export function sweepAttachments(): number {
  let removed = 0
  const dir = legacyBlobDir()
  try {
    const referenced = new Set(sqliteIndex.attachmentBlobPaths())
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (referenced.has(full)) continue
      try {
        unlinkSync(full)
        removed++
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no legacy dir */
  }
  return removed
}
