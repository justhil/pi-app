import { cn } from '@renderer/lib/utils'
import {
  GRAPH_RAIL_WIDTH,
  LANE_COL_PX,
  MAX_GRAPH_LANES,
  type GitLaneLayout,
} from './session-tree-git-lanes'
import type { SessionTreeNode } from './session-tree-list'

const ROW_H = 26
const MID = ROW_H / 2

function laneX(lane: number): number {
  return 3 + lane * LANE_COL_PX + LANE_COL_PX / 2
}

export function SessionTreeGraphColumn({
  index,
  nodes,
  layout,
}: {
  index: number
  nodes: SessionTreeNode[]
  layout: GitLaneLayout
}) {
  const n = nodes[index]
  const L = layout.lane[index]
  const cx = laneX(L)
  const parentIdx = layout.parent[index]
  const pLane = parentIdx != null ? layout.lane[parentIdx] : L
  const pcx = laneX(pLane)
  const onPath = layout.pathIds.has(n.id)
  const cont = layout.continues[index] || []
  const lineCls = onPath ? 'stroke-primary/55' : 'stroke-border/80'
  const dotCls = onPath ? 'fill-primary' : n.isLeaf ? 'fill-primary/80' : 'fill-muted-foreground/55'

  return (
    <svg
      width={GRAPH_RAIL_WIDTH}
      height={ROW_H}
      className="shrink-0 text-border"
      aria-hidden
    >
      {cont.map((draw, c) =>
        draw && c !== L ? (
          <line
            key={c}
            x1={laneX(c)}
            y1={0}
            x2={laneX(c)}
            y2={ROW_H}
            className={cn('stroke-[1.25]', lineCls)}
          />
        ) : null,
      )}
      {parentIdx != null && (
        <>
          <line x1={pcx} y1={0} x2={pcx} y2={MID} className={cn('stroke-[1.25]', lineCls)} />
          {pcx !== cx && (
            <line x1={Math.min(pcx, cx)} y1={MID} x2={Math.max(pcx, cx)} y2={MID} className={cn('stroke-[1.25]', lineCls)} />
          )}
          <line x1={cx} y1={MID} x2={cx} y2={ROW_H} className={cn('stroke-[1.25]', lineCls)} />
        </>
      )}
      {parentIdx == null && index > 0 && (
        <line x1={cx} y1={0} x2={cx} y2={ROW_H} className={cn('stroke-[1.25]', lineCls)} />
      )}
      <circle cx={cx} cy={MID} r={onPath || n.isLeaf ? 3.25 : 2.75} className={dotCls} />
    </svg>
  )
}

export { GRAPH_RAIL_WIDTH, MAX_GRAPH_LANES }