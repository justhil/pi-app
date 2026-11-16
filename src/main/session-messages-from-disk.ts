import { buildTimelinePageFromSessionFile, type SessionTouchedFile } from '@shared/session-jsonl-timeline'
import { extractBranchTouchedFiles, timelineItemsFromBranchPath } from '../worker/worker-timeline.js'

/** Preview timeline from JSONL without a live Worker RPC (same branch/leaf rules as Worker getMessages). */
export type DiskSessionMessages = Awaited<ReturnType<typeof buildTimelinePageFromSessionFile>>

export async function getSessionMessagesFromDisk(
  sessionFile: string,
  offset?: number,
  limit?: number,
  leafId?: string | null,
  activeSdkPath?: string | null,
): Promise<{
  items: Array<Record<string, unknown>>
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
  touchedFiles?: SessionTouchedFile[]
}> {
  return buildTimelinePageFromSessionFile(
    sessionFile,
    { offset, limit, leafId, activeSdkPath },
    timelineItemsFromBranchPath,
    extractBranchTouchedFiles,
  )
}