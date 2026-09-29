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

const EMPTY_CHILDREN: SubagentSessionChild[] = []
let memoItems: TimelineItem[] | null = null
let memoVersion = -1
let memoSignature = ''
let memoChildren: SubagentSessionChild[] = EMPTY_CHILDREN

/**
 * Store selector for the sidebar: the same array instance comes back until the active children
 * actually change, so a streaming token (new `timelineItems` every frame) does not re-render
 * every project's session tree. `version` busts the memo when tool-card templates load.
 */
export function selectActiveSubagentSessionChildren(
  items: TimelineItem[],
  version = 0,
): SubagentSessionChild[] {
  if (items === memoItems && version === memoVersion) return memoChildren
  memoItems = items
  memoVersion = version
  const next = collectActiveSubagentSessionChildren(items)
  const signature = next
    .map((child) => `${child.key}\u0001${child.state}\u0001${child.sessionFile ?? ''}\u0001${child.agent}\u0001${child.task ?? ''}`)
    .join('\u0002')
  if (signature !== memoSignature) {
    memoSignature = signature
    memoChildren = next.length ? next : EMPTY_CHILDREN
  }
  return memoChildren
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
