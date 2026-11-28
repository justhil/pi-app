import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Minus, Plus, RotateCcw, X } from '@renderer/components/icons'
import { compileExpression, expressionToLatex, type CompiledExpression } from '../engine'
import { useBlockState } from '../block-state'
import { seriesColor } from '../format'
import { BlockFrame } from '../frame'
import { useUiBlockKatex } from '../katex-lazy'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { useElementWidth } from '../use-element-width'
import { niceScale } from './chart-math'

type FunctionEntry = { expr: string }
type FunctionPlotProps = {
  title?: string
  functions: FunctionEntry[]
  x?: number[]
  y?: number[]
}

type Viewport = { xMin: number; xMax: number; yMin: number; yMax: number }
type Curve =
  | { kind: 'explicit-y'; fn: CompiledExpression }
  | { kind: 'explicit-x'; fn: CompiledExpression }
  | { kind: 'implicit'; fn: CompiledExpression }
type PlotRow = { id: number; expr: string; hidden: boolean }

const MAX_FUNCTIONS = 8
const PLOT_HEIGHT = 276
const MIN_SPAN = 1e-4
const MAX_SPAN = 1e5

function assertVars(compiled: CompiledExpression, allowed: readonly string[]): void {
  const bad = compiled.variables.find((name) => !allowed.includes(name))
  if (bad) throw new Error(`未知变量 ${bad}`)
}

function parseCurve(text: string): Curve {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('空表达式')
  const parts = trimmed.split('=')
  if (parts.length > 2) throw new Error('仅允许一个等号')
  if (parts.length === 1) {
    const fn = compileExpression(trimmed)
    assertVars(fn, ['x'])
    return { kind: 'explicit-y', fn }
  }
  const lhs = parts[0].trim()
  const rhs = parts[1].trim()
  if (!lhs || !rhs) throw new Error('等式不完整')
  if (lhs === 'y' || /^[a-zA-Z]\(x\)$/.test(lhs)) {
    const fn = compileExpression(rhs)
    assertVars(fn, ['x'])
    return { kind: 'explicit-y', fn }
  }
  if (lhs === 'x' || /^[a-zA-Z]\(y\)$/.test(lhs)) {
    const fn = compileExpression(rhs)
    assertVars(fn, ['y'])
    return { kind: 'explicit-x', fn }
  }
  const fn = compileExpression(`(${lhs}) - (${rhs})`)
  assertVars(fn, ['x', 'y'])
  return { kind: 'implicit', fn }
}

function exprLatex(text: string): string | null {
  try {
    return text
      .split('=')
      .map((s) => expressionToLatex(s.trim()))
      .join(' = ')
  } catch {
    return null
  }
}

function initialViewport(xBounds?: number[], yBounds?: number[], aspect = 1.8): Viewport {
  const xMin = xBounds && xBounds.length >= 2 && xBounds[0] < xBounds[1] ? xBounds[0] : -6
  const xMax = xBounds && xBounds.length >= 2 && xBounds[0] < xBounds[1] ? xBounds[1] : 6
  if (yBounds && yBounds.length >= 2 && yBounds[0] < yBounds[1]) {
    return { xMin, xMax, yMin: yBounds[0], yMax: yBounds[1] }
  }
  const halfY = (xMax - xMin) / (2 * Math.max(0.5, aspect))
  return { xMin, xMax, yMin: -halfY, yMax: halfY }
}

function sampleExplicitY(fn: CompiledExpression, vp: Viewport, w: number, h: number): string {
  const samples = Math.min(480, Math.max(180, Math.round(w * 0.9)))
  const xSpan = vp.xMax - vp.xMin
  const ySpan = vp.yMax - vp.yMin
  const dx = xSpan / samples
  const d: string[] = []
  let open = false
  let prevPy = 0
  for (let i = 0; i <= samples; i += 1) {
    const x = vp.xMin + i * dx
    let y = Number.NaN
    try {
      y = fn.evaluate({ x })
    } catch {
      y = Number.NaN
    }
    if (!Number.isFinite(y) || y < vp.yMin - ySpan * 4 || y > vp.yMax + ySpan * 4) {
      open = false
      continue
    }
    const px = ((x - vp.xMin) / xSpan) * w
    const py = h - ((y - vp.yMin) / ySpan) * h
    if (open && Math.abs(py - prevPy) > h * 0.85) open = false
    d.push(`${open ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
    prevPy = py
    open = true
  }
  return d.join('')
}

function sampleExplicitX(fn: CompiledExpression, vp: Viewport, w: number, h: number): string {
  const samples = Math.min(360, Math.max(140, Math.round(h * 0.9)))
  const xSpan = vp.xMax - vp.xMin
  const ySpan = vp.yMax - vp.yMin
  const dy = ySpan / samples
  const d: string[] = []
  let open = false
  let prevPx = 0
  for (let i = 0; i <= samples; i += 1) {
    const y = vp.yMin + i * dy
    let x = Number.NaN
    try {
      x = fn.evaluate({ y })
    } catch {
      x = Number.NaN
    }
    if (!Number.isFinite(x) || x < vp.xMin - xSpan * 4 || x > vp.xMax + xSpan * 4) {
      open = false
      continue
    }
    const px = ((x - vp.xMin) / xSpan) * w
    const py = h - ((y - vp.yMin) / ySpan) * h
    if (open && Math.abs(px - prevPx) > w * 0.85) open = false
    d.push(`${open ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
    prevPx = px
    open = true
  }
  return d.join('')
}

/** Marching-squares zero contour for implicit equations like x^2 + y^2 = 9. */
function sampleImplicit(fn: CompiledExpression, vp: Viewport, w: number, h: number): string {
  const cols = 72
  const rows = Math.max(36, Math.round((cols * h) / Math.max(1, w)))
  const xSpan = vp.xMax - vp.xMin
  const ySpan = vp.yMax - vp.yMin
  const grid = new Float64Array((cols + 1) * (rows + 1))

  for (let r = 0; r <= rows; r += 1) {
    const y = vp.yMax - (r / rows) * ySpan
    for (let c = 0; c <= cols; c += 1) {
      const x = vp.xMin + (c / cols) * xSpan
      let val = Number.NaN
      try {
        val = fn.evaluate({ x, y })
      } catch {
        val = Number.NaN
      }
      grid[r * (cols + 1) + c] = val
    }
  }

  const segs: string[] = []
  const cellW = w / cols
  const cellH = h / rows
  const interp = (a: number, b: number) => {
    const denom = a - b
    return Math.abs(denom) < 1e-12 ? 0.5 : a / denom
  }

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v00 = grid[r * (cols + 1) + c]
      const v10 = grid[r * (cols + 1) + c + 1]
      const v11 = grid[(r + 1) * (cols + 1) + c + 1]
      const v01 = grid[(r + 1) * (cols + 1) + c]
      if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue
      const pts: [number, number][] = []
      const x0 = c * cellW
      const y0 = r * cellH
      if ((v00 > 0) !== (v10 > 0)) pts.push([x0 + interp(v00, v10) * cellW, y0])
      if ((v10 > 0) !== (v11 > 0)) pts.push([x0 + cellW, y0 + interp(v10, v11) * cellH])
      if ((v01 > 0) !== (v11 > 0)) pts.push([x0 + interp(v01, v11) * cellW, y0 + cellH])
      if ((v00 > 0) !== (v01 > 0)) pts.push([x0, y0 + interp(v00, v01) * cellH])
      if (pts.length >= 2) {
        segs.push(`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`)
        if (pts.length === 4) {
          segs.push(`M${pts[2][0].toFixed(1)},${pts[2][1].toFixed(1)}L${pts[3][0].toFixed(1)},${pts[3][1].toFixed(1)}`)
        }
      }
    }
  }
  return segs.join('')
}

const MathChip = memo(function MathChip({ expr }: { expr: string }) {
  const renderKatex = useUiBlockKatex()
  const html = useMemo(() => {
    if (!renderKatex) return null
    const tex = exprLatex(expr)
    return tex ? renderKatex(tex) : null
  }, [expr, renderKatex])
  if (!html) return <span className="uib-fplot-raw">{expr}</span>
  return <span className="uib-fplot-math" dangerouslySetInnerHTML={{ __html: html }} />
})

const schema = v.object<FunctionPlotProps>({
  title: v.optional(v.string()),
  functions: v.array(v.object<FunctionEntry>({ expr: v.string() }), { min: 1, max: MAX_FUNCTIONS }),
  x: v.optional(v.array(v.number(), { min: 2, max: 2 })),
  y: v.optional(v.array(v.number(), { min: 2, max: 2 })),
})

function FunctionPlot({ props, blockKey, animate }: UIBlockComponentProps<FunctionPlotProps>) {
  const [containerRef, width] = useElementWidth(520)
  const plotW = Math.max(240, width)
  const aspect = plotW / PLOT_HEIGHT
  const defaultVp = useMemo(() => initialViewport(props.x, props.y, aspect), [props.x, props.y, aspect])
  const [vp, setVp] = useState<Viewport>(defaultVp)
  const [rows, setRows] = useBlockState<PlotRow[]>(blockKey, 'rows', () =>
    props.functions.slice(0, MAX_FUNCTIONS).map((f, idx) => ({ id: idx + 1, expr: f.expr, hidden: false })),
  )
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number; vp: Viewport } | null>(null)

  const compiledRows = useMemo(
    () =>
      rows.map((row) => {
        try {
          return { ...row, curve: parseCurve(row.expr), error: null as string | null }
        } catch (err) {
          return { ...row, curve: null, error: err instanceof Error ? err.message : '表达式无效' }
        }
      }),
    [rows],
  )

  const paths = useMemo(
    () =>
      compiledRows.map((row) => {
        if (row.hidden || !row.curve) return ''
        if (row.curve.kind === 'explicit-y') return sampleExplicitY(row.curve.fn, vp, plotW, PLOT_HEIGHT)
        if (row.curve.kind === 'explicit-x') return sampleExplicitX(row.curve.fn, vp, plotW, PLOT_HEIGHT)
        return sampleImplicit(row.curve.fn, vp, plotW, PLOT_HEIGHT)
      }),
    [compiledRows, vp, plotW],
  )

  const xTicks = useMemo(() => niceScale(vp.xMin, vp.xMax, 6).ticks, [vp.xMin, vp.xMax])
  const yTicks = useMemo(() => niceScale(vp.yMin, vp.yMax, 5).ticks, [vp.yMin, vp.yMax])

  const toPxX = useCallback((x: number) => ((x - vp.xMin) / (vp.xMax - vp.xMin)) * plotW, [vp.xMin, vp.xMax, plotW])
  const toPxY = useCallback((y: number) => PLOT_HEIGHT - ((y - vp.yMin) / (vp.yMax - vp.yMin)) * PLOT_HEIGHT, [vp.yMin, vp.yMax])

  const zoom = useCallback((factor: number, cx = (vp.xMin + vp.xMax) / 2, cy = (vp.yMin + vp.yMax) / 2) => {
    setVp((cur) => {
      const nextXSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (cur.xMax - cur.xMin) * factor))
      const nextYSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (cur.yMax - cur.yMin) * factor))
      const rx = (cx - cur.xMin) / (cur.xMax - cur.xMin)
      const ry = (cy - cur.yMin) / (cur.yMax - cur.yMin)
      return {
        xMin: cx - rx * nextXSpan,
        xMax: cx + (1 - rx) * nextXSpan,
        yMin: cy - ry * nextYSpan,
        yMax: cy + (1 - ry) * nextYSpan,
      }
    })
  }, [vp.xMax, vp.xMin, vp.yMax, vp.yMin])

  const axisX = toPxX(0)
  const axisY = toPxY(0)

  const addCurve = () => {
    setRows((prev) => {
      if (prev.length >= MAX_FUNCTIONS) return prev
      const maxId = prev.reduce((m, r) => Math.max(m, r.id), 0)
      return [...prev, { id: maxId + 1, expr: 'sin(x)', hidden: false }]
    })
  }

  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        <div className="uib-fplot-tools">
          <button type="button" className="uib-icon-btn" onClick={() => zoom(1 / 1.4)} title="放大" aria-label="放大">
            <Plus className="h-3 w-3" />
          </button>
          <button type="button" className="uib-icon-btn" onClick={() => zoom(1.4)} title="缩小" aria-label="缩小">
            <Minus className="h-3 w-3" />
          </button>
          <button type="button" className="uib-icon-btn" onClick={() => setVp(defaultVp)} title="重置视野" aria-label="重置视野">
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      }
    >
      <div ref={containerRef} className="uib-fplot-stage">
        <svg
          width={plotW}
          height={PLOT_HEIGHT}
          className="uib-fplot-svg"
          role="img"
          aria-label={props.title || '函数图像'}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const cx = vp.xMin + ((e.clientX - rect.left) / rect.width) * (vp.xMax - vp.xMin)
            const cy = vp.yMax - ((e.clientY - rect.top) / rect.height) * (vp.yMax - vp.yMin)
            zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy)
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { x: e.clientX, y: e.clientY, vp }
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - rect.left
            const py = e.clientY - rect.top
            if (dragRef.current) {
              const dx = ((e.clientX - dragRef.current.x) / plotW) * (dragRef.current.vp.xMax - dragRef.current.vp.xMin)
              const dy = ((e.clientY - dragRef.current.y) / PLOT_HEIGHT) * (dragRef.current.vp.yMax - dragRef.current.vp.yMin)
              setVp({
                xMin: dragRef.current.vp.xMin - dx,
                xMax: dragRef.current.vp.xMax - dx,
                yMin: dragRef.current.vp.yMin + dy,
                yMax: dragRef.current.vp.yMax + dy,
              })
            } else if (rect.width > 0 && rect.height > 0) {
              setHoverCoord({
                x: vp.xMin + (px / rect.width) * (vp.xMax - vp.xMin),
                y: vp.yMax - (py / rect.height) * (vp.yMax - vp.yMin),
                px,
                py,
              })
            }
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerLeave={() => {
            dragRef.current = null
            setHoverCoord(null)
          }}
        >
          {/* Grid lines */}
          {xTicks.map((t) => {
            const px = toPxX(t)
            return px >= 0 && px <= plotW ? (
              <g key={`gx-${t}`}>
                <line x1={px} y1={0} x2={px} y2={PLOT_HEIGHT} className="uib-grid" />
                {Math.abs(t) > 1e-9 ? (
                  <text
                    x={px + 2}
                    y={Math.min(PLOT_HEIGHT - 6, Math.max(12, axisY + 13))}
                    className="uib-axis"
                  >
                    {Number(t.toFixed(2))}
                  </text>
                ) : null}
              </g>
            ) : null
          })}
          {yTicks.map((t) => {
            const py = toPxY(t)
            return py >= 0 && py <= PLOT_HEIGHT ? (
              <g key={`gy-${t}`}>
                <line x1={0} y1={py} x2={plotW} y2={py} className="uib-grid" />
                {Math.abs(t) > 1e-9 ? (
                  <text
                    x={Math.min(plotW - 26, Math.max(4, axisX + 5))}
                    y={py - 3}
                    className="uib-axis"
                  >
                    {Number(t.toFixed(2))}
                  </text>
                ) : null}
              </g>
            ) : null
          })}
          {/* Principal axes */}
          {axisX >= 0 && axisX <= plotW ? <line x1={axisX} y1={0} x2={axisX} y2={PLOT_HEIGHT} className="uib-fplot-axis" /> : null}
          {axisY >= 0 && axisY <= PLOT_HEIGHT ? <line x1={0} y1={axisY} x2={plotW} y2={axisY} className="uib-fplot-axis" /> : null}
          {/* Curves */}
          {compiledRows.map((row, idx) =>
            paths[idx] ? (
              <path
                key={row.id}
                d={paths[idx]}
                fill="none"
                stroke={seriesColor(idx)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null,
          )}
          {/* Hover crosshair */}
          {hoverCoord ? (
            <g pointerEvents="none">
              <line x1={hoverCoord.px} y1={0} x2={hoverCoord.px} y2={PLOT_HEIGHT} className="uib-crosshair" />
              <line x1={0} y1={hoverCoord.py} x2={plotW} y2={hoverCoord.py} className="uib-crosshair" />
            </g>
          ) : null}
        </svg>
        {hoverCoord ? (
          <div className="uib-fplot-readout">
            ({hoverCoord.x.toFixed(2)}, {hoverCoord.y.toFixed(2)})
          </div>
        ) : null}
      </div>

      {/* Editable formula list */}
      <div className="uib-fplot-list">
        {compiledRows.map((row, idx) => (
          <div key={row.id} className="uib-fplot-row" data-error={row.error ? 'true' : undefined}>
            <button
              type="button"
              onClick={() =>
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, hidden: !r.hidden } : r)))
              }
              title={row.hidden ? '显示曲线' : '隐藏曲线'}
              className="uib-fplot-eye"
              style={{ color: row.hidden ? 'var(--uib-faint)' : seriesColor(idx) }}
            >
              {row.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <input
              type="text"
              value={row.expr}
              aria-label={`函数 ${idx + 1}`}
              onChange={(e) => {
                const next = e.target.value
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, expr: next } : r)))
              }}
              className="uib-fplot-input"
            />
            {row.error ? (
              <span className="uib-fplot-err">{row.error}</span>
            ) : (
              <MathChip expr={row.expr} />
            )}
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                title="移除函数"
                aria-label="移除函数"
                className="uib-icon-btn"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
        {rows.length < MAX_FUNCTIONS ? (
          <button type="button" onClick={addCurve} className="uib-btn uib-btn-quiet uib-fplot-add">
            <Plus className="h-3 w-3" />
            <span>添加函数</span>
          </button>
        ) : null}
      </div>
    </BlockFrame>
  )
}

export const functionPlotDefinition: UIBlockDefinition<FunctionPlotProps> = {
  name: 'function-plot',
  schema,
  Component: FunctionPlot,
  skeleton: 'chart',
}
