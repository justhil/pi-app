import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { SubagentSessionGroup } from '@renderer/lib/subagent-session-types'
import { useUIStore } from '@renderer/stores/ui-store'

export function isSubagentSessionPreview(
  group: SubagentSessionGroup | null | undefined,
  sessionFile: string | null | undefined,
): boolean {
  return !!group && sessionFilesEqual(group.previewSessionFile, sessionFile)
}

export function isCurrentSubagentSessionPreview(): boolean {
  const state = useUIStore.getState()
  return isSubagentSessionPreview(state.subagentSessionGroup, state.historySessionFile)
}
