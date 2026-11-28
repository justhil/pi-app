import { Component, memo, useMemo, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRight } from '@renderer/components/icons'
import { useCanvasStore } from '@renderer/features/canvas/canvas-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { parseBlockSource, type BlockSource } from './engine'
import { claimEntryAnimation, contentHash } from './block-state'
import { LiveBlock } from './live/live-block'
import { peekComponentName, peekItemCount } from './protocol'
import { UI_BLOCK_REGISTRY } from './registry'
import { validate, type Issue } from './schema'
import { skeletonKindFor, UIBlockSkeleton } from './skeleton'
import './ui-blocks.css'

const UIBlockRuntime = memo(function UIBlockRuntime({
  raw,
  streaming,
  inCanvas = false,
}: {
  raw: string
  streaming: boolean
  inCanvas?: boolean
}) {
  const parsed = useMemo(() => parseBlockSource(raw, streaming), [raw, streaming])
  if (parsed.status === 'incomplete') {
    return <UIBlockSkeleton kind={skeletonKindFor(peekComponentName(raw))} items={peekItemCount(raw)} />
  }
  if (parsed.status === 'invalid') {
    return <UIBlockFallback raw={raw} reason="invalid" detail={parsed.message} />
  }
  return <ResolvedBlock block={parsed.block} raw={raw} streaming={streaming} inCanvas={inCanvas} />
})

export default UIBlockRuntime

function ResolvedBlock({
  block,
  raw,
  streaming,
  inCanvas,
}: {
  block: BlockSource
  raw: string
  streaming: boolean
  inCanvas: boolean
}) {
  const blockKey = useMemo(
    () => (block.id ? `${block.component}:${block.id}` : `${block.component}:${contentHash(raw)}`),
    [block.component, block.id, raw],
  )

  const openInCanvas = () => {
    const title =
      typeof block.root.props.title === 'string' && block.root.props.title.trim()
        ? block.root.props.title.trim()
        : block.id || block.component
    const sessionFile = useUIStore.getState().historySessionFile ?? null
    useCanvasStore.getState().presentSurface({
      id: `uib-${block.id || contentHash(raw)}`,
      title,
      kind: 'ui-block',
      source: 'user',
      sessionFile,
      focus: true,
      payload: {
        component: block.component,
        props: block.root.props,
        raw,
      },
    })
    useRightDockStore.getState().activatePanelSmart('canvas')
    useUIStore.getState().revealRightPanel()
  }

  // Live blocks (panel / state / computed / children) stream node-by-node immediately.
  if (block.live) {
    return (
      <UIBlockBoundary raw={raw}>
        <div className="uib-root group/uib" data-component={block.component}>
          <LiveBlock block={block} blockKey={blockKey} streaming={streaming} />
          {!streaming && !inCanvas ? <OpenInCanvasBar onOpen={openInCanvas} /> : null}
        </div>
      </UIBlockBoundary>
    )
  }

  if (!block.root.closed) {
    if (!streaming) {
      return <UIBlockFallback raw={raw} reason="invalid" detail="incomplete JSON" />
    }
    return <UIBlockSkeleton kind={skeletonKindFor(block.component)} items={peekItemCount(raw)} />
  }

  return (
    <StaticResolvedBlock
      block={block}
      blockKey={blockKey}
      raw={raw}
      streaming={streaming}
      inCanvas={inCanvas}
      onOpenInCanvas={openInCanvas}
    />
  )
}

function StaticResolvedBlock({
  block,
  blockKey,
  raw,
  streaming,
  inCanvas,
  onOpenInCanvas,
}: {
  block: BlockSource
  blockKey: string
  raw: string
  streaming: boolean
  inCanvas: boolean
  onOpenInCanvas: () => void
}) {
  const definition = UI_BLOCK_REGISTRY.get(block.component)
  const result = useMemo(
    () => (definition ? validate(definition.schema, block.root.props) : null),
    [definition, block.root.props],
  )
  const [entry] = useState(() => claimEntryAnimation(blockKey, streaming))

  if (!definition) return <UIBlockFallback raw={raw} reason="unknown" detail={block.component} />
  if (!result || !result.ok) {
    return <UIBlockFallback raw={raw} reason="invalid" detail={formatIssues(result?.issues ?? [])} />
  }
  const Rendered = definition.Component
  return (
    <UIBlockBoundary raw={raw}>
      <div
        className="uib-root group/uib"
        data-component={block.component}
        style={
          entry.animate && entry.elapsed > 0
            ? ({ '--uib-elapsed': `${Math.round(entry.elapsed)}ms` } as CSSProperties)
            : undefined
        }
      >
        <Rendered props={result.value} blockKey={blockKey} animate={entry.animate} />
        {!streaming && !inCanvas ? <OpenInCanvasBar onOpen={onOpenInCanvas} /> : null}
      </div>
    </UIBlockBoundary>
  )
}

function OpenInCanvasBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="uib-open-canvas-row">
      <button type="button" onClick={onOpen} className="uib-open-canvas-btn">
        <PanelRight className="h-3 w-3" />
        <span>在画布打开</span>
      </button>
    </div>
  )
}

function formatIssues(issues: Issue[]): string {
  const head = issues.slice(0, 3).map((issue) => `${issue.path.replace(/^\$\.?/, '') || 'props'}: ${issue.message}`)
  return issues.length > 3 ? `${head.join('; ')} (+${issues.length - 3})` : head.join('; ')
}

export function UIBlockFallback({
  raw,
  reason,
  detail,
}: {
  raw: string
  reason: 'invalid' | 'unknown' | 'crashed'
  detail?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="uib-frame uib-fallback" role="note">
      <div className="uib-fallback-head">
        <span className="uib-fallback-dot" aria-hidden />
        <span className="uib-fallback-text">
          {t(`timeline:uiBlock.fallback.${reason}`)}
          {detail ? <span className="uib-fallback-detail"> · {detail}</span> : null}
        </span>
        <button type="button" className="uib-btn uib-btn-quiet" onClick={() => setOpen((value) => !value)}>
          {open ? t('timeline:uiBlock.hideSource') : t('timeline:uiBlock.showSource')}
        </button>
      </div>
      {open ? <pre className="uib-fallback-source">{raw.trim()}</pre> : null}
    </div>
  )
}

class UIBlockBoundary extends Component<{ raw: string; children: ReactNode }, { failed: boolean; message?: string }> {
  state: { failed: boolean; message?: string } = { failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('[pi-ui] block render failed', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <UIBlockFallback raw={this.props.raw} reason="crashed" detail={this.state.message} />
    }
    return this.props.children
  }
}
