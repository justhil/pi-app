import { basename, dirname, extname, join } from 'node:path'
import { findAdapterByTool } from './adapter-loader.js'
import { extractJsonPath } from './json-path.js'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function safePathSegment(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const segment = value.trim()
  if (!segment || segment === '.' || segment === '..') return undefined
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) return undefined
  return segment
}

function childIndex(row: UnknownRecord, indexPath: string | undefined, fallbackIndex: number): number {
  const configuredIndex = indexPath ? extractJsonPath(row, indexPath) : undefined
  return Number.isInteger(configuredIndex) && Number(configuredIndex) >= 0
    ? Number(configuredIndex)
    : fallbackIndex
}

function enrichRows(
  rows: unknown,
  indexPath: string | undefined,
  buildSessionFile: (index: number) => string,
): { rows: unknown; changed: boolean } {
  if (!Array.isArray(rows)) return { rows, changed: false }

  let changed = false
  const enrichedRows = rows.map((row, fallbackIndex) => {
    const record = asRecord(row)
    const explicitSessionFile = typeof record?.sessionFile === 'string'
      ? record.sessionFile.trim()
      : ''
    if (!record || explicitSessionFile) return row

    changed = true
    return {
      ...record,
      sessionFile: buildSessionFile(childIndex(record, indexPath, fallbackIndex)),
    }
  })

  return {
    rows: changed ? enrichedRows : rows,
    changed,
  }
}

/**
 * Apply a declarative adapter path convention to live tree-tool details.
 * Explicit sessionFile values from the extension always remain authoritative.
 */
export function enrichToolChildSessionFiles(
  toolName: string,
  parentSessionFile: string | undefined,
  details: unknown,
): unknown {
  if (!parentSessionFile) return details
  const detailRecord = asRecord(details)
  if (!detailRecord) return details

  const childSession = findAdapterByTool(toolName)?.toolCard?.childSession
  if (!childSession || childSession.layout !== 'parent-session-run-directory') return details

  const runId = safePathSegment(extractJsonPath(detailRecord, childSession.runIdPath))
  if (!runId) return details

  const parentExtension = extname(parentSessionFile)
  const parentStem = basename(parentSessionFile, parentExtension)
  const sessionRoot = join(dirname(parentSessionFile), parentStem, runId)
  const childDirectoryPrefix = childSession.childDirectoryPrefix ?? 'run-'
  const fileName = safePathSegment(childSession.fileName ?? 'session.jsonl')
  if (!fileName || (childDirectoryPrefix && !safePathSegment(childDirectoryPrefix))) {
    return details
  }

  const buildSessionFile = (index: number) => join(
    sessionRoot,
    `${childDirectoryPrefix}${index}`,
    fileName,
  )
  const enrichedResults = enrichRows(
    detailRecord.results,
    childSession.resultIndexPath,
    buildSessionFile,
  )
  const enrichedProgress = enrichRows(
    detailRecord.progress,
    childSession.progressIndexPath,
    buildSessionFile,
  )

  if (!enrichedResults.changed && !enrichedProgress.changed) return details
  return {
    ...detailRecord,
    ...(enrichedResults.changed ? { results: enrichedResults.rows } : {}),
    ...(enrichedProgress.changed ? { progress: enrichedProgress.rows } : {}),
  }
}
