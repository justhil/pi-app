import { resolveToolCardTemplate } from '@renderer/features/timeline/tool-card-registry'
import {
  normalizeTreeToolItem,
  type TreeToolItem,
} from '@renderer/features/timeline/tree-tool-model'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type {
  SubagentSessionChild,
  SubagentSessionGroup,
} from '@renderer/lib/subagent-session-types'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { ToolEvent } from '@shared/app-events'

function isActiveChild(child: SubagentSessionChild): boolean {
  return child.state === 'pending' || child.state === 'running'
}

function childIdentity(child: SubagentSessionChild): string {
  return child.sessionFile
    ? normalizeSessionFileKey(child.sessionFile) || child.sessionFile
    : child.key
}

function activeChildrenFromTreeItem(item: TreeToolItem): SubagentSessionChild[] {
  if (item.toolPhase !== 'start' && item.toolPhase !== 'update') return []
  return normalizeTreeToolItem(item).children
    .filter(isActiveChild)
    .map((child) => ({
      key: child.key,
      agent: child.agent,
      task: child.task,
      state: child.state,
      sessionFile: child.sessionFile,
    }))
}

export function collectActiveSubagentSessionChildren(items: TimelineItem[]): SubagentSessionChild[] {
  const children: SubagentSessionChild[] = []
  const seenIdentities = new Set<string>()

  for (const item of items) {
    if (item.type !== 'tool-call' || resolveToolCardTemplate(item.toolName) !== 'tree') continue
    for (const child of activeChildrenFromTreeItem(item)) {
      const identity = childIdentity(child)
      if (seenIdentities.has(identity)) continue
      seenIdentities.add(identity)
      children.push(child)
    }
  }

  return children
}

export function reduceSubagentSessionGroupToolEvent(
  group: SubagentSessionGroup,
  event: ToolEvent,
): SubagentSessionGroup {
  if (!event.sessionFile || !sessionFilesEqual(event.sessionFile, group.parentSessionFile)) {
    return group
  }

  const childKeyPrefix = `${event.toolCallId}:`
  const belongsToKnownTreeRun = group.children.some((child) => child.key.startsWith(childKeyPrefix))
  if (resolveToolCardTemplate(event.toolName) !== 'tree' && !belongsToKnownTreeRun) return group
  if (event.phase === 'update' && event.details === undefined && belongsToKnownTreeRun) {
    return group
  }
  const activeChildren = activeChildrenFromTreeItem({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    toolPhase: event.phase,
    toolArgs: event.input,
    toolDetails: event.details,
    toolOutput: typeof event.output === 'string' ? event.output : undefined,
    isError: event.isError,
  })
  if (
    event.phase !== 'end'
    && event.details === undefined
    && activeChildren.length === 0
  ) {
    return group
  }

  const otherChildren = group.children.filter((child) => !child.key.startsWith(childKeyPrefix))

  return {
    ...group,
    children: [...otherChildren, ...activeChildren],
  }
}
