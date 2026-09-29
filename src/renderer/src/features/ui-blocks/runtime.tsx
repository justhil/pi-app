import { Component, useMemo, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseUIBlock, type UIBlockEnvelope } from './envelope'
import { claimEntryAnimation, contentHash } from './block-state'
import { peekComponentName, peekItemCount } from './protocol'
import { UI_BLOCK_REGISTRY } from './registry'
import { validate, type Issue } from './schema'
import { skeletonKindFor, UIBlockSkeleton } from './skeleton'
import './ui-blocks.css'

export default function UIBlockRuntime({ raw, streaming }: { raw: string; streaming: boolean }) {
  const parsed = useMemo(() => parseUIBlock(raw, streaming), [raw, streaming])
  if (parsed.status === 'incomplete') {
    return <UIBlockSkeleton kind={skeletonKindFor(peekComponentName(raw))} items={peekItemCount(raw)} />
  }
  if (parsed.status === 'invalid') {
    return <UIBlockFallback raw={raw} reason="invalid" detail={parsed.message} />
  }
  return <ResolvedBlock envelope={parsed.envelope} raw={raw} streaming={streaming} />
}

function ResolvedBlock({ envelope, raw, streaming }: { envelope: UIBlockEnvelope; raw: string; streaming: boolean }) {
  const definition = UI_BLOCK_REGISTRY.get(envelope.component)
  const result = useMemo(
    () => (definition ? validate(definition.schema, envelope.props) : null),
    [definition, envelope.props],
  )
  const blockKey = `${envelope.component}:${envelope.id}:${contentHash(raw)}`
  // Decided once per mount: history never animates, a live remount resumes (see claimEntryAnimation).
  const [entry] = useState(() => claimEntryAnimation(blockKey, streaming))
  if (!definition) return <UIBlockFallback raw={raw} reason="unknown" detail={envelope.component} />
  if (!result || !result.ok) {
    return <UIBlockFallback raw={raw} reason="invalid" detail={formatIssues(result?.issues ?? [])} />
  }
  const Rendered = definition.Component
  return (
    <UIBlockBoundary raw={raw}>
      <div
        className="uib-root"
        data-component={envelope.component}
        style={entry.animate && entry.elapsed > 0 ? ({ '--uib-elapsed': `${Math.round(entry.elapsed)}ms` } as CSSProperties) : undefined}
      >
        <Rendered props={result.value} blockKey={blockKey} animate={entry.animate} />
      </div>
    </UIBlockBoundary>
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
