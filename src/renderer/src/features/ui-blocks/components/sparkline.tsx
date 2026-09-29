import { memo, useMemo, useState } from 'react'

const W = 100
const H = 28

/** Tiny trend line with hover readout; drawn in a 100×28 viewBox scaled to the card width. */
export const Sparkline = memo(function Sparkline({
  values,
  labels,
  tone,
  animate,
  onHover,
}: {
  values: Array<number | null>
  labels?: string[]
  tone: 'up' | 'down' | 'flat' | undefined
  animate: boolean
  onHover?: (text: string | null) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const geometry = useMemo(() => {
    const finite = values.filter((value): value is number => value != null)
    if (finite.length < 2) return null
    const min = Math.min(...finite)
    const max = Math.max(...finite)
    const span = max - min || 1
    const step = W / Math.max(1, values.length - 1)
    const points = values.map((value, index) =>
      value == null ? null : { x: index * step, y: H - 2 - ((value - min) / span) * (H - 4) },
    )
    const segments: string[] = []
    let open = false
    for (const point of points) {
      if (!point) {
        open = false
        continue
      }
      segments.push(`${open ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      open = true
    }
    const line = segments.join(' ')
    const first = points.find(Boolean)!
    const last = [...points].reverse().find(Boolean)!
    const area = `${line} L${last.x.toFixed(2)},${H} L${first.x.toFixed(2)},${H} Z`
    return { points, line, area, step }
  }, [values])
  if (!geometry) return null
  const point = hovered != null ? geometry.points[hovered] : null
  return (
    <svg
      className={animate ? 'uib-spark uib-reveal' : 'uib-spark'}
      data-tone={tone ?? 'flat'}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const index = Math.round(((event.clientX - box.left) / box.width) * (values.length - 1))
        const clamped = Math.max(0, Math.min(values.length - 1, index))
        setHovered(clamped)
        const value = values[clamped]
        onHover?.(value == null ? null : `${labels?.[clamped] ?? `#${clamped + 1}`} · ${value}`)
      }}
      onPointerLeave={() => {
        setHovered(null)
        onHover?.(null)
      }}
      aria-hidden
    >
      <path className="uib-spark-area" d={geometry.area} />
      <path className="uib-spark-line" d={geometry.line} />
      {/* Zero-length round-capped stroke: stays a circle under the non-uniform viewBox stretch. */}
      {point ? <path className="uib-spark-dot" d={`M${point.x.toFixed(2)},${point.y.toFixed(2)}h0`} /> : null}
    </svg>
  )
})
