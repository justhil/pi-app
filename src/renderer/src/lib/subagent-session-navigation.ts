import { resolveToolCardTemplate } from '@renderer/features/timeline/tool-card-registry'
import { normalizeTreeToolItem } from '@renderer/features/timeline/tree-tool-model'
import { previewSessionInPlace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { assertSessionNavigation, beginSessionNavigation } from '@renderer/lib/session-navigation'
import { isSubagentSessionPreview } from '@renderer/lib/subagent-session-preview'
import { collectActiveSubagentSessionChildren } from '@renderer/lib/subagent-session-activity'
import type {
  SubagentSessionChild,
  SubagentSessionGroup,
} from '@renderer/lib/subagent-session-types'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

export function collectSubagentSessionChildren(items: TimelineItem[]): SubagentSessionChild[] {
  const children: SubagentSessionChild[] = []
  const seenKeys = new Set<string>()

  for (const item of items) {
    if (item.type !== 'tool-call' || resolveToolCardTemplate(item.toolName) !== 'tree') continue
    for (const child of normalizeTreeToolItem(item).children) {
      const identity = child.sessionFile
        ? normalizeSessionFileKey(child.sessionFile) || child.sessionFile
        : child.key
      if (seenKeys.has(identity)) continue
      seenKeys.add(identity)
      children.push({
        key: child.key,
        agent: child.agent,
        task: child.task,
        state: child.state,
        sessionFile: child.sessionFile,
      })
    }
  }

  return children
}

function mergeSessionChildren(
  retainedChildren: SubagentSessionChild[],
  currentChildren: SubagentSessionChild[],
): SubagentSessionChild[] {
  const merged = [...retainedChildren]
  const identities = new Set(
    retainedChildren.map((child) => child.sessionFile
      ? normalizeSessionFileKey(child.sessionFile) || child.sessionFile
      : child.key),
  )

  for (const child of currentChildren) {
    const identity = child.sessionFile
      ? normalizeSessionFileKey(child.sessionFile) || child.sessionFile
      : child.key
    if (identities.has(identity)) continue
    identities.add(identity)
    merged.push(child)
  }

  return merged
}

function resolveNavigationGroup(targetSessionFile: string): SubagentSessionGroup | null {
  const state = useUIStore.getState()
  const retainedGroup = state.subagentSessionGroup
  if (state.currentWorkspace && state.currentSessionId && state.historySessionFile) {
    const children = collectSubagentSessionChildren(state.timelineItems)
    if (children.some(
      (child) => child.sessionFile && sessionFilesEqual(child.sessionFile, targetSessionFile),
    )) {
      if (
        retainedGroup
        && (
          sessionFilesEqual(state.historySessionFile, retainedGroup.parentSessionFile)
          || isSubagentSessionPreview(retainedGroup, state.historySessionFile)
        )
      ) {
        return {
          ...retainedGroup,
          previewSessionFile: targetSessionFile,
          children: mergeSessionChildren(
            retainedGroup.children,
            collectActiveSubagentSessionChildren(state.timelineItems),
          ),
        }
      }
      return {
        workspacePath: state.currentWorkspace,
        parentSessionId: state.currentSessionId,
        parentSessionFile: state.historySessionFile,
        previewSessionFile: targetSessionFile,
        children: collectActiveSubagentSessionChildren(state.timelineItems),
      }
    }
  }

  return retainedGroup?.children.some(
    (child) => child.sessionFile && sessionFilesEqual(child.sessionFile, targetSessionFile),
  )
    ? { ...retainedGroup, previewSessionFile: targetSessionFile }
    : null
}

function resolvePreparedNavigationGroup(
  group: SubagentSessionGroup,
  requestedSessionFile: string,
  preparedSessionFile: string,
): SubagentSessionGroup {
  return {
    ...group,
    previewSessionFile: preparedSessionFile,
    children: group.children.map((child) =>
      child.sessionFile && sessionFilesEqual(child.sessionFile, requestedSessionFile)
        ? { ...child, sessionFile: preparedSessionFile }
        : child,
    ),
  }
}

export async function openSubagentSessionPreview(sessionFile: string): Promise<void> {
  const navigationGroup = resolveNavigationGroup(sessionFile)
  if (!navigationGroup) return
  const navToken = beginSessionNavigation()

  const prepared = await ipcClient
    .invoke('session.prepare', { sessionFile, bind: false })
    .catch(() => null)
  if (!prepared?.sessionId || !assertSessionNavigation(navToken)) return

  const preparedSessionFile = typeof prepared.sessionFile === 'string' && prepared.sessionFile.trim()
    ? prepared.sessionFile
    : sessionFile
  useUIStore.getState().setSubagentSessionGroup(resolvePreparedNavigationGroup(
    navigationGroup,
    sessionFile,
    preparedSessionFile,
  ))
  await previewSessionInPlace(prepared.sessionId, preparedSessionFile, navToken)
}
