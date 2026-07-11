import { useEffect, useMemo, useState } from 'react'
import { cn } from '@renderer/lib/utils'

/** Soft 3×3 running pulse for sidebar sessions. */
const GRID = 3
const CELL_COUNT = GRID * GRID
const CELL_PX = 3
const GAP_PX = 1.5
const GRID_OUTER_PX = GRID * CELL_PX + (GRID - 1) * GAP_PX

function pickLitCells(count: number, seed: number): Set<number> {
  const indices = Array.from({ length: CELL_COUNT }, (_, i) => i)
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  for (let i = CELL_COUNT - 1; i > 0; i--) {
    const j = next() % (i + 1)
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return new Set(indices.slice(0, Math.min(count, CELL_COUNT)))
}

/**
 * Quiet 3×3 grid: a few soft cells drift on/off.
 * Meant to sit beside session meta like a status glyph, not a badge.
 */
export function SessionRunningPixelGrid({
  className,
  title,
}: {
  className?: string
  title?: string
}) {
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setEpoch((n) => n + 1), 1400)
    return () => window.clearInterval(timer)
  }, [])

  const lit = useMemo(() => {
    // Light 3–4 cells only — sparse, not a filled block.
    const count = 3 + (epoch % 2)
    const seed = (epoch + 1) * 2654435761
    return pickLitCells(count, seed)
  }, [epoch])

  return (
    <div
      className={cn('session-running-pixel-grid shrink-0', className)}
      title={title}
      aria-hidden
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID}, ${CELL_PX}px)`,
        gridTemplateRows: `repeat(${GRID}, ${CELL_PX}px)`,
        gap: `${GAP_PX}px`,
        width: GRID_OUTER_PX,
        height: GRID_OUTER_PX,
      }}
    >
      {Array.from({ length: CELL_COUNT }, (_, index) => (
        <span
          key={index}
          className={cn(
            'session-running-pixel',
            lit.has(index) && 'session-running-pixel--on',
          )}
          style={
            lit.has(index)
              ? { transitionDelay: `${(index % 3) * 40}ms` }
              : { transitionDelay: `${(index % 3) * 20}ms` }
          }
        />
      ))}
    </div>
  )
}
