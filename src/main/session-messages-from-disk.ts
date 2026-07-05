import { buildTimelinePageFromSessionFile } from '@shared/session-jsonl-timeline'
import { timelineItemsFromBranchPath } from '../worker/worker-timeline.js'
import { resolveActiveSdk } from './sdk-loader'
import { app } from 'electron'

/** Preview timeline from JSONL without a live Worker RPC (same branch/leaf rules as Worker getMessages). */
export async function getSessionMessagesFromDisk(
  sessionFile: string,
  offset?: number,
  limit?: number,
  leafId?: string | null,
): Promise<{
  items: Array<Record<string, unknown>>
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}> {
  const active = resolveActiveSdk(app.getPath('userData'))
  const activeSdkPath = active.kind === 'builtin' ? null : active.entryPath
  return buildTimelinePageFromSessionFile(
    sessionFile,
    { offset, limit, leafId, activeSdkPath },
    timelineItemsFromBranchPath,
  )
}