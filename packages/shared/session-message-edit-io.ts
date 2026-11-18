import { randomBytes } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  rewriteSessionJsonlMessage,
  type EditableMessageRole,
  type SessionMessageEditError,
} from './session-message-edit'

export type AtomicSessionFileEditResult =
  | {
      ok: true
      role: EditableMessageRole
    }
  | {
      ok: false
      error: SessionMessageEditError | string
    }

/**
 * Atomically rewrite one message entry inside a `.jsonl` session file using async `fs/promises`
 * (safe on both host paths and Windows `\\wsl.localhost` UNC paths).
 */
export async function rewriteSessionMessageFileAtomically(
  filePath: string,
  entryId: string,
  nextText: string,
): Promise<AtomicSessionFileEditResult> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') return { ok: false, error: 'entry_not_found' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const rewritten = rewriteSessionJsonlMessage(raw, entryId, nextText)
  if (!rewritten.ok) return rewritten

  const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  const tmpPath = join(dirname(filePath), `.pi-edit-${suffix}`)
  try {
    await writeFile(tmpPath, rewritten.jsonl, 'utf8')
    try {
      await rename(tmpPath, filePath)
    } catch (renameErr: unknown) {
      const code = (renameErr as NodeJS.ErrnoException | undefined)?.code
      if (code === 'EPERM' || code === 'EACCES' || code === 'EXDEV') {
        await writeFile(filePath, rewritten.jsonl, 'utf8')
        await unlink(tmpPath).catch(() => {})
      } else {
        throw renameErr
      }
    }
    return { ok: true, role: rewritten.role }
  } catch (e: unknown) {
    await unlink(tmpPath).catch(() => {})
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
