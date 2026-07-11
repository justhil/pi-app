import { cn } from '@renderer/lib/utils'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'

export type ContextRoleKey = 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other'

export type ContextRoleSlice = {
  role: ContextRoleKey | string
  chars: number
}

/** Soft, tool-like palette — muted, not neon */
export const CONTEXT_ROLE_COLORS: Record<string, string> = {
  system: 'var(--aou-6)',
  user: '#5b8def',
  assistant: 'var(--brand)',
  tool: '#c4923a',
  summary: '#8b7ec8',
  other: 'var(--text-disabled)',
  free: 'var(--bg-3)',
}

const ROLE_ORDER: ContextRoleKey[] = ['system', 'user', 'assistant', 'tool', 'summary', 'other']

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

function describeDonutArc(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle
  if (sweep <= 0.01) return ''
  // Full circle: SVG arc can't draw 360° in one path
  if (sweep >= 359.99) {
    const topOuter = polarToCartesian(centerX, centerY, outerRadius, 0)
    const bottomOuter = polarToCartesian(centerX, centerY, outerRadius, 180)
    const topInner = polarToCartesian(centerX, centerY, innerRadius, 0)
    const bottomInner = polarToCartesian(centerX, centerY, innerRadius, 180)
    return [
      `M ${topOuter.x} ${topOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${bottomOuter.x} ${bottomOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${topOuter.x} ${topOuter.y}`,
      `L ${topInner.x} ${topInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${bottomInner.x} ${bottomInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${topInner.x} ${topInner.y}`,
      'Z',
    ].join(' ')
  }
  const startOuter = polarToCartesian(centerX, centerY, outerRadius, endAngle)
  const endOuter = polarToCartesian(centerX, centerY, outerRadius, startAngle)
  const startInner = polarToCartesian(centerX, centerY, innerRadius, endAngle)
  const endInner = polarToCartesian(centerX, centerY, innerRadius, startAngle)
  const largeArcFlag = sweep > 180 ? 1 : 0
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ')
}

export function buildContextRoleSlices(
  breakdown: ContextRoleSlice[] | null | undefined,
  estimatedChars: number,
): ContextRoleSlice[] {
  if (breakdown && breakdown.length > 0) {
    return ROLE_ORDER.map((role) => {
      const found = breakdown.find((slice) => slice.role === role)
      return found && found.chars > 0 ? found : null
    }).filter((slice): slice is ContextRoleSlice => slice != null)
  }
  if (estimatedChars > 0) {
    return [{ role: 'other', chars: estimatedChars }]
  }
  return []
}

export function ContextDonutChart({
  slices,
  contextWindow,
  estimatedChars,
  size = 88,
  className,
  centerLabel,
  centerSub,
}: {
  slices: ContextRoleSlice[]
  contextWindow?: number | null
  estimatedChars: number
  size?: number
  className?: string
  centerLabel?: string
  centerSub?: string
}) {
  const usedTokens = estTokensFromChars(estimatedChars)
  const windowTokens =
    contextWindow != null && contextWindow > 0 ? contextWindow : null
  const freeTokens =
    windowTokens != null ? Math.max(0, windowTokens - usedTokens) : 0

  const chartSlices: Array<{ key: string; tokens: number; color: string }> = slices.map((slice) => ({
    key: slice.role,
    tokens: Math.max(0, estTokensFromChars(slice.chars)),
    color: CONTEXT_ROLE_COLORS[slice.role] || CONTEXT_ROLE_COLORS.other,
  }))

  if (windowTokens != null && freeTokens > 0) {
    chartSlices.push({
      key: 'free',
      tokens: freeTokens,
      color: CONTEXT_ROLE_COLORS.free,
    })
  }

  const totalTokens = chartSlices.reduce((sum, slice) => sum + slice.tokens, 0)
  const center = size / 2
  const outerRadius = size / 2 - 1
  const innerRadius = outerRadius * 0.62

  let cursorAngle = 0
  const arcs =
    totalTokens > 0
      ? chartSlices
          .filter((slice) => slice.tokens > 0)
          .map((slice) => {
            const sweep = (slice.tokens / totalTokens) * 360
            const startAngle = cursorAngle
            const endAngle = cursorAngle + sweep
            cursorAngle = endAngle
            return {
              ...slice,
              path: describeDonutArc(center, center, outerRadius, innerRadius, startAngle, endAngle),
              pct: (slice.tokens / totalTokens) * 100,
            }
          })
      : []

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" aria-hidden>
        {arcs.length === 0 ? (
          <circle
            cx={center}
            cy={center}
            r={(outerRadius + innerRadius) / 2}
            fill="none"
            stroke="var(--bg-3)"
            strokeWidth={outerRadius - innerRadius}
          />
        ) : (
          arcs.map((arc) => (
            <path
              key={arc.key}
              d={arc.path}
              fill={arc.color}
              className="transition-[opacity] duration-200"
              opacity={arc.key === 'free' ? 0.55 : 0.92}
            />
          ))
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-1 text-center">
        <span className="text-[12px] font-semibold tabular-nums leading-none text-foreground">
          {centerLabel ?? formatTokens(usedTokens)}
        </span>
        {centerSub != null && (
          <span className="mt-0.5 text-[9px] leading-tight text-foreground-secondary/70">{centerSub}</span>
        )}
      </div>
    </div>
  )
}

export function ContextRoleLegend({
  slices,
  labels,
  freeLabel,
  freeTokens,
}: {
  slices: ContextRoleSlice[]
  labels: Record<string, string>
  freeLabel?: string
  freeTokens?: number | null
}) {
  const totalChars = Math.max(
    1,
    slices.reduce((sum, slice) => sum + slice.chars, 0) +
      (freeTokens != null && freeTokens > 0 ? freeTokens * 4 : 0),
  )

  const rows = [
    ...slices.map((slice) => ({
      key: slice.role,
      label: labels[slice.role] || slice.role,
      chars: slice.chars,
      color: CONTEXT_ROLE_COLORS[slice.role] || CONTEXT_ROLE_COLORS.other,
    })),
    ...(freeTokens != null && freeTokens > 0 && freeLabel
      ? [
          {
            key: 'free',
            label: freeLabel,
            chars: freeTokens * 4,
            color: CONTEXT_ROLE_COLORS.free,
          },
        ]
      : []),
  ]

  return (
    <ul className="min-w-0 flex-1 space-y-1">
      {rows.map((row) => {
        const pct = (row.chars / totalChars) * 100
        return (
          <li key={row.key} className="flex items-center gap-2 text-[11px] leading-tight">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: row.color, opacity: row.key === 'free' ? 0.55 : 1 }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground-secondary">{row.label}</span>
            <span className="shrink-0 tabular-nums text-foreground-secondary/80">
              {formatTokens(estTokensFromChars(row.chars))}
              <span className="ml-1 text-foreground-secondary/50">{pct.toFixed(0)}%</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
