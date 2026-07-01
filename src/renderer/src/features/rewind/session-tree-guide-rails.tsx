import { cn } from '@renderer/lib/utils'
import { ancestorVerticals, isLastSiblingAtDepth, TREE_GUIDE_COL_PX } from './session-tree-guides'
import type { SessionTreeNode } from './session-tree-list'

const line = 'bg-border/70'

function GuideColumn({ showVertical }: { showVertical: boolean }) {
  return (
    <div
      className="relative shrink-0 self-stretch"
      style={{ width: TREE_GUIDE_COL_PX }}
      aria-hidden
    >
      {showVertical && (
        <span className={cn('absolute left-[7px] top-0 bottom-0 w-px', line)} />
      )}
    </div>
  )
}

function ConnectorColumn({ isLast }: { isLast: boolean }) {
  return (
    <div
      className="relative shrink-0 self-stretch"
      style={{ width: TREE_GUIDE_COL_PX }}
      aria-hidden
    >
      {isLast ? (
        <>
          <span className={cn('absolute left-[7px] top-0 h-[14px] w-px', line)} />
          <span className={cn('absolute left-[7px] top-[13px] right-0 h-px', line)} />
        </>
      ) : (
        <>
          <span className={cn('absolute left-[7px] top-0 bottom-0 w-px', line)} />
          <span className={cn('absolute left-[7px] top-[13px] right-0 h-px', line)} />
        </>
      )}
    </div>
  )
}

export function SessionTreeGuideRails({
  nodes,
  index,
}: {
  nodes: SessionTreeNode[]
  index: number
}) {
  const depth = nodes[index]?.depth ?? 0
  if (depth <= 0) return null
  const verticals = ancestorVerticals(nodes, index)
  const isLast = isLastSiblingAtDepth(nodes, index)
  return (
    <div className="flex shrink-0 self-stretch pt-0.5">
      {verticals.map((v, col) => (
        <GuideColumn key={col} showVertical={v} />
      ))}
      <ConnectorColumn isLast={isLast} />
    </div>
  )
}