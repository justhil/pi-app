import { basename, dirname, join } from 'node:path'
import { readSessionMetaFromFile } from './session-file-meta'
import type { SessionOnDiskRow } from './ipc/sdk-session'

type ListSessions = (workspaceId: string) => Promise<SessionOnDiskRow[]>

type PreparedSession = {
  sessionId: string
  sessionFile: string
}

type DerivedChildSessionLocator = {
  parentSessionFile: string
  runId: string
  childNumber: number
}

function parseDerivedChildSessionLocator(
  candidateSessionFile: string,
): DerivedChildSessionLocator | null {
  if (basename(candidateSessionFile) !== 'session.jsonl') return null

  const childDirectory = dirname(candidateSessionFile)
  const childDirectoryName = basename(childDirectory)
  const childIndexMatch = /^run-(\d+)$/.exec(childDirectoryName)
  if (!childIndexMatch) return null

  const runDirectory = dirname(childDirectory)
  const runId = basename(runDirectory)
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) return null

  const parentSessionDirectory = dirname(runDirectory)
  const parentSessionFile = join(
    dirname(parentSessionDirectory),
    `${basename(parentSessionDirectory)}.jsonl`,
  )

  return {
    parentSessionFile,
    runId,
    childNumber: Number(childIndexMatch[1]) + 1,
  }
}

function sessionModifiedAt(session: SessionOnDiskRow): number {
  return session.modified?.getTime() ?? 0
}

/** Resolve either a direct child JSONL or a fork-context session represented by an adapter candidate path. */
export async function resolvePreparedSessionFile(
  candidateSessionFile: string,
  listSessions: ListSessions,
): Promise<PreparedSession | null> {
  const directMeta = readSessionMetaFromFile(candidateSessionFile)
  if (directMeta) {
    return {
      sessionId: directMeta.sessionId,
      sessionFile: candidateSessionFile,
    }
  }

  const locator = parseDerivedChildSessionLocator(candidateSessionFile)
  if (!locator) return null

  const parentMeta = readSessionMetaFromFile(locator.parentSessionFile)
  if (!parentMeta?.cwd) return null

  const expectedNameSuffix = `-${locator.runId}-${locator.childNumber}`
  const matchingSessions = (await listSessions(parentMeta.cwd))
    .filter((session) => session.name?.endsWith(expectedNameSuffix))
    .sort((left, right) => sessionModifiedAt(right) - sessionModifiedAt(left))
  const matchedSession = matchingSessions[0]
  if (!matchedSession?.id || !matchedSession.path) return null

  return {
    sessionId: matchedSession.id,
    sessionFile: matchedSession.path,
  }
}
