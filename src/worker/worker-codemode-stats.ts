import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { InlineExtension } from '@earendil-works/pi-coding-agent'
import { computeMutateCallDiffStats, diffLineStatsFromStrings } from '@shared/tool-call-detail'

const MAX_SNAPSHOT_BYTES = 512 * 1024

type MutateStats = { path?: string; additions: number; deletions: number }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resolveWritePath(input: unknown, cwd: string): { rawPath: string; absPath: string } | null {
  const rec = asRecord(input)
  const raw = typeof rec?.path === 'string' ? rec.path : typeof rec?.file_path === 'string' ? rec.file_path : ''
  if (!raw) return null
  return { rawPath: raw, absPath: isAbsolute(raw) ? raw : resolve(cwd, raw) }
}

/**
 * Stamps exact `{ path, additions, deletions }` from nested `edit`/`write` calls onto
 * parent `codemode` `details.calls` before Pi persists the `toolResult` to JSONL.
 */
export const codemodeStatsExtension: InlineExtension = {
  name: 'pi-desktop-codemode-stats',
  builtin: true,
  hidden: true,
  factory: (pi) => {
    const preWriteContents = new Map<string, string>()
    const nestedStatsByParent = new Map<string, Map<string, MutateStats>>()

    pi.on('tool_call', async (event, ctx) => {
      const parentId = (event as { parentToolCallId?: string }).parentToolCallId
      if (!parentId || event.toolName !== 'write') return undefined
      const resolved = resolveWritePath(event.input, ctx.cwd)
      if (!resolved) return undefined
      try {
        const st = await stat(resolved.absPath)
        if (st.isFile() && st.size <= MAX_SNAPSHOT_BYTES) {
          const buf = await readFile(resolved.absPath)
          if (!buf.includes(0)) {
            preWriteContents.set(event.toolCallId, buf.toString('utf8'))
          }
        }
      } catch {
        /* new file */
      }
      return undefined
    })

    pi.on('tool_result', async (event) => {
      const parentId = (event as { parentToolCallId?: string }).parentToolCallId
      if (parentId) {
        const oldContent = preWriteContents.get(event.toolCallId)
        preWriteContents.delete(event.toolCallId)
        if (event.isError) return undefined
        const name = event.toolName.toLowerCase()
        if (name !== 'edit' && name !== 'write' && name !== 'insert') return undefined

        let stats: MutateStats
        if (name === 'write' && oldContent !== undefined) {
          const inputRec = asRecord(event.input)
          const newContent = typeof inputRec?.content === 'string' ? inputRec.content : ''
          const rawPath =
            typeof inputRec?.path === 'string'
              ? inputRec.path
              : typeof inputRec?.file_path === 'string'
                ? inputRec.file_path
                : undefined
          stats = {
            ...(rawPath ? { path: rawPath } : {}),
            ...diffLineStatsFromStrings(oldContent, newContent),
          }
        } else {
          stats = computeMutateCallDiffStats(name, event.input, event.details)
        }

        let map = nestedStatsByParent.get(parentId)
        if (!map) {
          map = new Map()
          nestedStatsByParent.set(parentId, map)
        }
        map.set(event.toolCallId, stats)
        return undefined
      }

      if (event.toolName !== 'codemode') return undefined
      const byCallId = nestedStatsByParent.get(event.toolCallId)
      nestedStatsByParent.delete(event.toolCallId)
      if (!byCallId || byCallId.size === 0) return undefined

      const det = asRecord(event.details)
      if (!det || !Array.isArray(det.calls)) return undefined
      let changed = false
      const calls = det.calls.map((raw) => {
        const c = asRecord(raw)
        if (!c || typeof c.id !== 'string') return raw
        const hit = byCallId.get(c.id)
        if (!hit) return raw
        changed = true
        return {
          ...c,
          ...(hit.path ? { path: hit.path } : {}),
          additions: hit.additions,
          deletions: hit.deletions,
        }
      })
      return changed ? { details: { ...det, calls } } : undefined
    })

    pi.on('agent_end', async () => {
      preWriteContents.clear()
      nestedStatsByParent.clear()
    })
  },
}
