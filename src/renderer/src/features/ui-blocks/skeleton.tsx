import type { SkeletonKind } from './types'

const KIND_BY_COMPONENT: Record<string, SkeletonKind> = {
  chart: 'chart',
  'stat-grid': 'cards',
  'card-grid': 'cards',
  'data-table': 'rows',
  gantt: 'rows',
  diff: 'rows',
  quiz: 'block',
  'decision-tree': 'block',
}

export function skeletonKindFor(component: string | null): SkeletonKind {
  return (component && KIND_BY_COMPONENT[component]) || 'block'
}

/** Reserves roughly the final height so the answer does not jump when the block resolves. */
export function UIBlockSkeleton({ kind, items }: { kind: SkeletonKind; items: number }) {
  const count = Math.max(2, Math.min(items || 0, kind === 'cards' ? 6 : 8))
  return (
    <div className="uib-frame uib-skeleton" data-kind={kind} aria-busy="true" aria-live="polite">
      <span className="uib-sk-line uib-sk-title" />
      {kind === 'chart' ? (
        <span className="uib-sk-box" style={{ height: 196 }} />
      ) : kind === 'cards' ? (
        <div className="uib-sk-cards">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className="uib-sk-box" style={{ height: 72 }} />
          ))}
        </div>
      ) : kind === 'rows' ? (
        <div className="uib-sk-rows">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className="uib-sk-line" style={{ width: `${88 - (index % 3) * 14}%` }} />
          ))}
        </div>
      ) : (
        <span className="uib-sk-box" style={{ height: 96 }} />
      )}
    </div>
  )
}
