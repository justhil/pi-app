import { Fragment, useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, RotateCcw, XCircle } from '@renderer/components/icons'
import type { ResolvedNode } from '../engine'
import {
  ChipButton,
  displayValue,
  LIVE_TONES,
  LiveChildren,
  optionIndex,
  readBoolean,
  readEnum,
  readNumber,
  readOptions,
  readText,
  useLiveBlock,
} from './live-context'
import { LiveButton, LiveInput, LiveSegmented, LiveSelect, LiveSlider, LiveSwitch } from './live-controls'
import { LiveFormula, LiveScene } from './live-visuals'

export function LivePrimitive({ node }: { node: ResolvedNode }) {
  switch (node.component) {
    case 'panel':
      return <LivePanel node={node} />
    case 'stack':
      return (
        <div className="uib-live-stack">
          <LiveChildren node={node} />
        </div>
      )
    case 'row':
      return (
        <div className="uib-live-row">
          <LiveChildren node={node} />
        </div>
      )
    case 'grid':
      return <LiveGrid node={node} />
    case 'card':
      return <LiveCard node={node} />
    case 'tabs':
      return <LiveTabs node={node} />
    case 'collapse':
      return <LiveCollapse node={node} />
    case 'divider':
      return <hr className="uib-live-divider" />
    case 'text':
      return <LiveText node={node} />
    case 'stat':
      return <LiveStat node={node} />
    case 'badge':
      return <LiveBadge node={node} />
    case 'progress':
      return <LiveProgress node={node} />
    case 'callout':
      return <LiveCallout node={node} />
    case 'formula':
      return <LiveFormula node={node} />
    case 'scene':
      return <LiveScene node={node} />
    case 'slider':
      return <LiveSlider node={node} />
    case 'select':
      return <LiveSelect node={node} />
    case 'segmented':
      return <LiveSegmented node={node} />
    case 'switch':
      return <LiveSwitch node={node} />
    case 'input':
      return <LiveInput node={node} />
    case 'button':
      return <LiveButton node={node} />
    default:
      return null
  }
}

function LivePanel({ node }: { node: ResolvedNode }) {
  const { changed, reset } = useLiveBlock()
  const title = readText(node.props, 'title')
  const description = readText(node.props, 'description')
  const isRoot = node.path === ''
  const showReset = isRoot && changed
  return (
    <section className={isRoot ? 'uib-live-panel' : 'uib-live-subpanel'}>
      {title || showReset ? (
        <div className="uib-header">
          {title ? <h4 className={isRoot ? 'uib-title uib-live-title-lg' : 'uib-title'}>{title}</h4> : <span />}
          {showReset ? (
            <button type="button" onClick={reset} className="uib-btn uib-btn-quiet">
              <RotateCcw className="h-3 w-3" />
              <span>重置</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {description ? <p className="uib-live-desc">{description}</p> : null}
      <LiveFlow node={node} />
    </section>
  )
}

/** Auto split-column explorable layout when a panel mixes `scene` with controls/formulas. */
function LiveFlow({ node }: { node: ResolvedNode }) {
  const { renderNode } = useLiveBlock()
  const visuals = node.children.filter((c) => c.component === 'scene')
  const asks = node.children.filter((c) => c.component === 'button' && typeof c.props.ask === 'string')
  const main = node.children.filter((c) => !visuals.includes(c) && !asks.includes(c))
  const render = (child: ResolvedNode) => <Fragment key={child.path}>{renderNode(child)}</Fragment>

  if (visuals.length === 0 || main.length === 0) {
    return (
      <div className="uib-live-stack">
        <LiveChildren node={node} />
      </div>
    )
  }

  return (
    <div className="uib-live-explorable">
      <div className="uib-live-explorable-grid">
        <div className="uib-live-stack">{main.map(render)}</div>
        <div className="uib-live-scene-tile">{visuals.map(render)}</div>
      </div>
      {asks.map(render)}
    </div>
  )
}

function LiveGrid({ node }: { node: ResolvedNode }) {
  const cols = Math.min(4, Math.max(1, Math.round(readNumber(node.props, 'columns') ?? 2)))
  return (
    <div className="uib-live-grid" data-cols={cols}>
      <LiveChildren node={node} />
    </div>
  )
}

function LiveCard({ node }: { node: ResolvedNode }) {
  const title = readText(node.props, 'title')
  return (
    <div className="uib-card uib-live-card">
      {title ? <div className="uib-live-card-title">{title}</div> : null}
      <LiveFlow node={node} />
    </div>
  )
}

function LiveTabs({ node }: { node: ResolvedNode }) {
  const { state, update, renderNode } = useLiveBlock()
  const items = readOptions(node.props, 'items')
  const [localIdx, setLocalIdx] = useState(0)
  const bind = node.bind
  const activeIdx = bind ? optionIndex(items, state[bind]) : Math.min(localIdx, Math.max(0, items.length - 1))
  const activeChild = node.children[activeIdx]

  if (items.length === 0) return <LiveChildren node={node} />
  return (
    <div className="uib-live-tabs">
      <div role="tablist" className="uib-live-chips">
        {items.map((item, idx) => (
          <ChipButton
            key={`${node.path}-tab-${idx}`}
            active={idx === activeIdx}
            onClick={() => {
              if (bind) update({ [bind]: item.value })
              else setLocalIdx(idx)
            }}
          >
            {item.label}
          </ChipButton>
        ))}
      </div>
      {activeChild ? <div className="uib-live-tab-body">{renderNode(activeChild)}</div> : null}
    </div>
  )
}

function LiveCollapse({ node }: { node: ResolvedNode }) {
  const [open, setOpen] = useState(() => readBoolean(node.props, 'open') ?? false)
  const title = readText(node.props, 'title') ?? '详情'
  return (
    <div className="uib-live-collapse">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="uib-live-collapse-head">
        <span>{title}</span>
        <ChevronDown className={open ? 'h-3.5 w-3.5 rotate-180 transition-transform' : 'h-3.5 w-3.5 transition-transform'} />
      </button>
      {open ? (
        <div className="uib-live-collapse-body">
          <LiveChildren node={node} />
        </div>
      ) : null}
    </div>
  )
}

const TEXT_SIZES = ['sm', 'base', 'lg'] as const

function LiveText({ node }: { node: ResolvedNode }) {
  const text = readText(node.props, 'text')
  if (!text) return null
  const tone = readEnum(node.props, 'tone', LIVE_TONES) ?? 'default'
  const size = readEnum(node.props, 'size', TEXT_SIZES) ?? 'base'
  return (
    <p className="uib-live-text" data-tone={tone} data-size={size}>
      {text}
    </p>
  )
}

function LiveStat({ node }: { node: ResolvedNode }) {
  const label = readText(node.props, 'label')
  const precision = readNumber(node.props, 'precision')
  const val = displayValue(node.props.value, precision)
  const unit = readText(node.props, 'unit')
  const note = readText(node.props, 'note')
  const highlight = readBoolean(node.props, 'highlight')
  const tone = readEnum(node.props, 'tone', LIVE_TONES) ?? 'default'
  return (
    <div className="uib-card uib-stat uib-live-stat" data-highlight={highlight || undefined} data-tone={tone}>
      {label ? <div className="uib-stat-label">{label}</div> : null}
      <div className="uib-stat-value">
        <span>{val}</span>
        {unit ? <span className="uib-stat-unit">{unit}</span> : null}
      </div>
      {note ? <div className="uib-stat-note">{note}</div> : null}
    </div>
  )
}

function LiveBadge({ node }: { node: ResolvedNode }) {
  const text = readText(node.props, 'text')
  if (!text) return null
  const tone = readEnum(node.props, 'tone', LIVE_TONES) ?? 'default'
  return (
    <span className="uib-live-badge" data-tone={tone}>
      {text}
    </span>
  )
}

function LiveProgress({ node }: { node: ResolvedNode }) {
  const value = readNumber(node.props, 'value') ?? 0
  const max = Math.max(0.0001, readNumber(node.props, 'max') ?? 100)
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const label = readText(node.props, 'label')
  const tone = readEnum(node.props, 'tone', LIVE_TONES) ?? 'info'
  return (
    <div className="uib-live-progress">
      <div className="uib-live-ctrl-head">
        <span className="uib-live-ctrl-label">{label ?? ''}</span>
        <span className="uib-live-ctrl-val">{Math.round(pct)}%</span>
      </div>
      <div className="uib-live-progress-track">
        <div className="uib-live-progress-bar" data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const CALLOUT_TONES = ['info', 'positive', 'warning', 'negative'] as const

function LiveCallout({ node }: { node: ResolvedNode }) {
  const text = readText(node.props, 'text')
  const title = readText(node.props, 'title')
  if (!text && !title) return null
  const tone = readEnum(node.props, 'tone', CALLOUT_TONES) ?? 'info'
  return (
    <div className="uib-live-callout" data-tone={tone} role="note">
      <span className="uib-live-callout-icon" aria-hidden>
        {tone === 'negative' ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : tone === 'warning' ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="uib-live-callout-body">
        {title ? <div className="uib-live-callout-title">{title}</div> : null}
        {text ? <div className="uib-live-callout-text">{text}</div> : null}
      </div>
    </div>
  )
}
