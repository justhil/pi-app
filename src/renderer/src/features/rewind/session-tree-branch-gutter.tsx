import {
  treeColX,
  treeGutterWidth,
  type SessionTreeLayoutRow,
} from './session-tree-layout'

const CURVE_R = 6
const FOLD_GAP = 7

function railStyle(active: boolean, branchColor: string | null): { color: string; opacity: number; width: number } {
  if (active) return { color: 'var(--brand)', opacity: 0.85, width: 1.75 }
  if (branchColor) return { color: branchColor, opacity: 0.56, width: 1.45 }
  return { color: 'hsl(var(--border))', opacity: 0.95, width: 1.4 }
}

export function SessionTreeBranchGutter({
  row,
  anchorY,
  containsLeaf = false,
  allowActiveTipMarker = true,
}: {
  row: SessionTreeLayoutRow
  /** Distance in px from row top to the primary text line's center (where dot / fold button / elbow align). */
  anchorY: number
  /** True when a turn card absorbs the active session leaf (e.g. its paired assistant reply). */
  containsLeaf?: boolean
  /** Disable active-tip halo during search filtering so truncated context ancestors aren't marked current. */
  allowActiveTipMarker?: boolean
}) {
  const width = treeGutterWidth(row.col)
  const cx = treeColX(row.col)
  const hasParent = row.parentId !== null && row.parentCol !== null
  const isBranchedElbow = hasParent && row.isForkChild && row.parentCol! < row.col
  const px = isBranchedElbow ? treeColX(row.parentCol!) : cx
  const armEndX = row.foldable ? Math.max(px + CURVE_R, cx - FOLD_GAP) : cx
  const stemTopEnd = row.foldable ? Math.max(0, anchorY - FOLD_GAP) : anchorY
  const stemBottomStart = row.foldable ? anchorY + FOLD_GAP : anchorY

  const svgHeight = anchorY + 10
  const isCurrentMarker = containsLeaf || row.node.isLeaf || (allowActiveTipMarker && row.isActiveTip)
  const isUser = row.node.entryType === 'message' && row.node.role === 'user'
  const isAssistant = row.node.entryType === 'message' && row.node.role === 'assistant'

  const elbowPath = `M ${px} ${anchorY - CURVE_R} Q ${px} ${anchorY} ${px + CURVE_R} ${anchorY} L ${armEndX} ${anchorY}`
  const inLine = railStyle(row.onActivePath, row.branchColor)
  const upperTrunk = railStyle(row.upperTrunkActive, row.upperTrunkColor)
  const lowerTrunk = railStyle(row.lowerTrunkActive, row.lowerTrunkColor)
  const outLine = railStyle(row.hasActiveChild, row.outgoingStemColor)

  return (
    <div
      data-tree-branch-gutter
      className="pointer-events-none relative h-full w-full"
      aria-hidden
    >
      {/* Full-height vertical rails for open ancestor branches */}
      {row.ancestorRails.map((rail) => {
        const st = railStyle(rail.active, rail.color)
        return (
          <span
            key={rail.col}
            style={{
              left: treeColX(rail.col) - st.width / 2,
              width: st.width,
              backgroundColor: st.color,
              opacity: st.opacity,
            }}
            className="absolute bottom-0 top-0"
          />
        )
      })}

      {/* Dynamic-height lower trunk below a non-last fork child */}
      {isBranchedElbow && !row.isLastChild && (
        <span
          style={{
            left: px - lowerTrunk.width / 2,
            top: anchorY - CURVE_R,
            width: lowerTrunk.width,
            backgroundColor: lowerTrunk.color,
            opacity: lowerTrunk.opacity,
          }}
          className="absolute bottom-0"
        />
      )}

      {/* Dynamic-height lower trunk when a fork is depth-capped */}
      {hasParent && !isBranchedElbow && row.isForkChild && !row.isLastChild && (
        <span
          style={{
            left: cx - lowerTrunk.width / 2,
            top: stemBottomStart,
            width: lowerTrunk.width,
            backgroundColor: lowerTrunk.color,
            opacity: lowerTrunk.opacity,
          }}
          className="absolute bottom-0"
        />
      )}

      {/* Dynamic-height outgoing stem into unfolded visible children */}
      {row.hasVisibleChildren && (
        <span
          style={{
            left: cx - outLine.width / 2,
            top: stemBottomStart,
            width: outLine.width,
            backgroundColor: outLine.color,
            opacity: outLine.opacity,
          }}
          className="absolute bottom-0"
        />
      )}

      {/* Fixed-top SVG for upper stems, rounded fork elbow, and node indicator */}
      <svg
        width={width}
        height={svgHeight}
        viewBox={`0 0 ${width} ${svgHeight}`}
        className="absolute left-0 top-0 block overflow-visible"
      >
        {hasParent && !isBranchedElbow && (
          <line
            x1={cx}
            y1={0}
            x2={cx}
            y2={stemTopEnd}
            stroke={inLine.color}
            strokeOpacity={inLine.opacity}
            strokeWidth={inLine.width}
          />
        )}

        {isBranchedElbow && (
          <>
            {!row.upperTrunkActive && (
              <line
                x1={px}
                y1={0}
                x2={px}
                y2={anchorY - CURVE_R}
                stroke={upperTrunk.color}
                strokeOpacity={upperTrunk.opacity}
                strokeWidth={upperTrunk.width}
              />
            )}
            {!row.onActivePath && (
              <path
                d={elbowPath}
                fill="none"
                stroke={inLine.color}
                strokeOpacity={inLine.opacity}
                strokeWidth={inLine.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {row.upperTrunkActive && (
              <line
                x1={px}
                y1={0}
                x2={px}
                y2={anchorY - CURVE_R}
                stroke={upperTrunk.color}
                strokeOpacity={upperTrunk.opacity}
                strokeWidth={upperTrunk.width}
              />
            )}
            {row.onActivePath && (
              <path
                d={elbowPath}
                fill="none"
                stroke={inLine.color}
                strokeOpacity={inLine.opacity}
                strokeWidth={inLine.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </>
        )}

        {!row.foldable && (
          isCurrentMarker ? (
            <>
              <circle cx={cx} cy={anchorY} r={5.4} fill="var(--brand)" fillOpacity={0.2} />
              <circle cx={cx} cy={anchorY} r={3} fill="var(--brand)" />
            </>
          ) : row.onActivePath ? (
            <circle
              cx={cx}
              cy={anchorY}
              r={isAssistant ? 2.2 : 2.8}
              fill="var(--brand)"
              fillOpacity={isAssistant ? 0.7 : 0.95}
            />
          ) : row.branchColor ? (
            <circle
              cx={cx}
              cy={anchorY}
              r={isAssistant ? 2.1 : 2.6}
              fill={row.branchColor}
              fillOpacity={isAssistant ? 0.55 : 0.85}
            />
          ) : isUser ? (
            <circle cx={cx} cy={anchorY} r={2.6} fill="hsl(var(--foreground))" fillOpacity={0.45} />
          ) : isAssistant ? (
            <circle cx={cx} cy={anchorY} r={2.1} fill="hsl(var(--muted-foreground))" fillOpacity={0.5} />
          ) : (
            <circle cx={cx} cy={anchorY} r={2.3} fill="#7c3aed" fillOpacity={0.65} />
          )
        )}
      </svg>
    </div>
  )
}
