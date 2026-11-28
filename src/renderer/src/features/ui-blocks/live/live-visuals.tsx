import { useId, useMemo } from 'react'
import { formulaToLatex, type ResolvedNode } from '../engine'
import { useUiBlockKatex } from '../katex-lazy'
import { LIVE_TONES, type LiveTone, readNumber, readText, useLiveBlock } from './live-context'

function KatexLine({ latex, className }: { latex: string; className?: string }) {
  const renderKatex = useUiBlockKatex()
  const html = useMemo(() => (renderKatex ? renderKatex(latex) : null), [latex, renderKatex])
  if (!html) return <code className={className}>{latex}</code>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Symbolic formula + live substituted worked line driven by block state. */
export function LiveFormula({ node }: { node: ResolvedNode }) {
  const { values } = useLiveBlock()
  const expr = readText(node.props, 'expr')
  const latex = useMemo(() => {
    if (!expr) return null
    try {
      return formulaToLatex(expr, {
        name: readText(node.props, 'name'),
        unit: readText(node.props, 'unit'),
        precision: readNumber(node.props, 'precision'),
        values,
        with: node.props.with,
      })
    } catch {
      return null
    }
  }, [expr, node.props, values])
  if (!latex) return null
  const label = readText(node.props, 'label')
  return (
    <div className="uib-live-formula">
      {label ? <div className="uib-live-formula-label">{label}</div> : null}
      <KatexLine latex={latex.symbolic} className="uib-live-formula-sym" />
      {latex.worked ? <KatexLine latex={latex.worked} className="uib-live-formula-worked" /> : null}
    </div>
  )
}

const MAX_SHAPES = 60
const MAX_SIZE = 1000
const LABEL_MAX_LENGTH = 40

type Shape = Record<string, unknown>

function clampSize(n: number): number {
  return Math.min(MAX_SIZE, Math.max(80, Math.round(n)))
}

function finite(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function toneOf(shape: Shape): LiveTone {
  const raw = typeof shape.tone === 'string' ? shape.tone.trim().toLowerCase() : ''
  return (LIVE_TONES as readonly string[]).includes(raw) ? (raw as LiveTone) : 'default'
}

function shapeLabel(shape: Shape): string | undefined {
  const raw = shape.label
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  return t ? t.slice(0, LABEL_MAX_LENGTH) : undefined
}

function SceneShape({ shape, markerId }: { shape: Shape; markerId: string }) {
  const tone = toneOf(shape)
  const label = shapeLabel(shape)
  const n = (k: string) => finite(shape[k])
  switch (shape.type) {
    case 'rect': {
      const x = n('x')
      const y = n('y')
      const w = n('w')
      const h = n('h')
      if (x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) return null
      return (
        <g data-tone={tone} className="uib-scene-shape">
          <rect x={x} y={y} width={w} height={h} rx={6} strokeWidth={1.6} />
          {label ? (
            <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={12}>
              {label}
            </text>
          ) : null}
        </g>
      )
    }
    case 'circle': {
      const cx = n('cx')
      const cy = n('cy')
      const r = n('r')
      if (cx === undefined || cy === undefined || r === undefined || r <= 0) return null
      return (
        <g data-tone={tone} className="uib-scene-shape">
          <circle cx={cx} cy={cy} r={r} strokeWidth={1.6} />
          {label ? (
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12}>
              {label}
            </text>
          ) : null}
        </g>
      )
    }
    case 'line':
    case 'arrow': {
      const x1 = n('x1')
      const y1 = n('y1')
      const x2 = n('x2')
      const y2 = n('y2')
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1)
      return (
        <g data-tone={tone} className="uib-scene-shape">
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={1.8}
            strokeLinecap="round"
            markerEnd={shape.type === 'arrow' ? `url(#${markerId}-${tone})` : undefined}
          />
          {label ? (
            <text
              x={vertical ? mx + 10 : mx}
              y={vertical ? my : my - 8}
              textAnchor={vertical ? 'start' : 'middle'}
              dominantBaseline="central"
              fontSize={12}
            >
              {label}
            </text>
          ) : null}
        </g>
      )
    }
    case 'text': {
      const x = n('x')
      const y = n('y')
      const txt = typeof shape.text === 'string' ? shape.text.trim().slice(0, LABEL_MAX_LENGTH) : label
      if (x === undefined || y === undefined || !txt) return null
      return (
        <g data-tone={tone} className="uib-scene-shape">
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={12}>
            {txt}
          </text>
        </g>
      )
    }
    default:
      return null
  }
}

/** Reactive coordinate-space SVG diagram whose shapes follow Live Panel state. */
export function LiveScene({ node }: { node: ResolvedNode }) {
  const markerId = `uib-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const width = clampSize(readNumber(node.props, 'width') ?? 360)
  const height = clampSize(readNumber(node.props, 'height') ?? 220)
  const shapes = Array.isArray(node.props.shapes)
    ? node.props.shapes.filter((s): s is Shape => Boolean(s && typeof s === 'object' && !Array.isArray(s))).slice(0, MAX_SHAPES)
    : []
  const usedTones = new Set(shapes.filter((s) => s.type === 'arrow').map(toneOf))

  return (
    <div className="uib-live-scene">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="uib-scene-svg"
        role="img"
        aria-label={readText(node.props, 'label') ?? '示意图'}
      >
        <defs>
          {Array.from(usedTones, (tone) => (
            <marker
              key={tone}
              id={`${markerId}-${tone}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" className="uib-scene-marker" data-tone={tone} />
            </marker>
          ))}
        </defs>
        {shapes.map((shape, index) => (
          <SceneShape key={`${node.path}-${index}`} shape={shape} markerId={markerId} />
        ))}
      </svg>
    </div>
  )
}
