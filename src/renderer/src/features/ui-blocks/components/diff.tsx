import { memo, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from '@renderer/components/icons'
import { useBlockState } from '../block-state'
import { BlockFrame, Segmented } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { buildDiffRows, type DiffRow, type Segment } from './line-diff'

type DiffProps = {
  title?: string
  before: string
  after: string
  language?: string
  beforeLabel?: string
  afterLabel?: string
}

const schema = v.object<DiffProps>({
  title: v.optional(v.string()),
  before: v.string(),
  after: v.string(),
  language: v.optional(v.string()),
  beforeLabel: v.optional(v.string()),
  afterLabel: v.optional(v.string()),
})

type View = 'unified' | 'split'
type LineRow = Exclude<DiffRow, { kind: 'fold' }>

function Text({ text, segments }: { text: string; segments?: Segment[] }): ReactNode {
  if (!segments || segments.every((segment) => !segment.changed)) return text || ' '
  return segments.map((segment, index) =>
    segment.changed ? (
      <mark key={index} className="uib-diff-word">
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  )
}

function UnifiedRow({ row }: { row: LineRow }) {
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '
  return (
    <div className="uib-diff-line" data-kind={row.kind}>
      <span className="uib-diff-no">{row.kind !== 'add' ? row.oldNo : ''}</span>
      <span className="uib-diff-no">{row.kind !== 'del' ? row.newNo : ''}</span>
      <span className="uib-diff-sign">{sign}</span>
      <span className="uib-diff-text">
        <Text text={row.text} segments={'segments' in row ? row.segments : undefined} />
      </span>
    </div>
  )
}

/** Pairs deletions with insertions line by line for the side-by-side view. */
function splitPairs(rows: LineRow[]): Array<[LineRow | null, LineRow | null]> {
  const out: Array<[LineRow | null, LineRow | null]> = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (row.kind === 'context') {
      out.push([row, row])
      index += 1
      continue
    }
    const dels: LineRow[] = []
    const adds: LineRow[] = []
    while (index < rows.length && rows[index].kind !== 'context') {
      if (rows[index].kind === 'del') dels.push(rows[index])
      else adds.push(rows[index])
      index += 1
    }
    for (let pair = 0; pair < Math.max(dels.length, adds.length); pair += 1) {
      out.push([dels[pair] ?? null, adds[pair] ?? null])
    }
  }
  return out
}

function SplitSide({ row, side }: { row: LineRow | null; side: 'old' | 'new' }) {
  if (!row) return <div className="uib-diff-line" data-kind="empty" />
  const number = side === 'old' ? (row.kind !== 'add' ? row.oldNo : '') : row.kind !== 'del' ? row.newNo : ''
  return (
    <div className="uib-diff-line" data-kind={row.kind}>
      <span className="uib-diff-no">{number}</span>
      <span className="uib-diff-text">
        <Text text={row.text} segments={'segments' in row ? row.segments : undefined} />
      </span>
    </div>
  )
}

const DiffBody = memo(function DiffBody({
  rows,
  view,
  expanded,
  onExpand,
  foldLabel,
}: {
  rows: DiffRow[]
  view: View
  expanded: string[]
  onExpand: (id: string) => void
  foldLabel: (count: number) => string
}) {
  // Expand folds in place, then render the flat line list.
  const lines: Array<LineRow | Extract<DiffRow, { kind: 'fold' }>> = []
  for (const row of rows) {
    if (row.kind === 'fold' && expanded.includes(row.id)) lines.push(...(row.rows as LineRow[]))
    else lines.push(row)
  }
  const chunks: Array<{ fold: Extract<DiffRow, { kind: 'fold' }> } | { lines: LineRow[] }> = []
  for (const line of lines) {
    if (line.kind === 'fold') chunks.push({ fold: line })
    else {
      const last = chunks[chunks.length - 1]
      if (last && 'lines' in last) last.lines.push(line)
      else chunks.push({ lines: [line] })
    }
  }
  return (
    <div className="uib-diff-body" data-view={view}>
      {chunks.map((chunk, index) =>
        'fold' in chunk ? (
          <button key={chunk.fold.id} type="button" className="uib-diff-fold" onClick={() => onExpand(chunk.fold.id)}>
            {foldLabel(chunk.fold.count)}
          </button>
        ) : view === 'split' ? (
          splitPairs(chunk.lines).map(([left, right], pair) => (
            <div key={`${index}-${pair}`} className="uib-diff-split-row">
              <SplitSide row={left} side="old" />
              <SplitSide row={right} side="new" />
            </div>
          ))
        ) : (
          chunk.lines.map((line, at) => <UnifiedRow key={`${index}-${at}`} row={line} />)
        ),
      )}
    </div>
  )
})

function DiffBlock({ props, blockKey, animate }: UIBlockComponentProps<DiffProps>) {
  const { t } = useTranslation()
  const model = useMemo(() => buildDiffRows(props.before, props.after), [props.before, props.after])
  const [view, setView] = useBlockState<View>(blockKey, 'view', 'unified')
  const [expanded, setExpanded] = useBlockState<string[]>(blockKey, 'expanded', [])
  const [copied, setCopied] = useState(false)
  const copyAfter = () => {
    void navigator.clipboard.writeText(props.after).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        <>
          <span className="uib-diff-stat">
            <span data-kind="add">+{model.added}</span>
            <span data-kind="del">−{model.removed}</span>
          </span>
          <Segmented
            label={t('timeline:uiBlock.diffView')}
            value={view}
            onChange={setView}
            options={[
              { value: 'unified', label: t('timeline:uiBlock.unified') },
              { value: 'split', label: t('timeline:uiBlock.split') },
            ]}
          />
          <button type="button" className="uib-icon-btn" onClick={copyAfter} aria-label={t('timeline:uiBlock.copyAfter')} title={t('timeline:uiBlock.copyAfter')}>
            {copied ? <Check /> : <Copy />}
          </button>
        </>
      }
    >
      {view === 'split' && (props.beforeLabel || props.afterLabel) ? (
        <div className="uib-diff-labels">
          <span>{props.beforeLabel ?? t('timeline:uiBlock.before')}</span>
          <span>{props.afterLabel ?? t('timeline:uiBlock.after')}</span>
        </div>
      ) : null}
      <DiffBody
        rows={model.rows}
        view={view}
        expanded={expanded}
        onExpand={(id) => setExpanded((previous) => [...previous, id])}
        foldLabel={(count) => t('timeline:uiBlock.expandLines', { count })}
      />
    </BlockFrame>
  )
}

export const diffDefinition: UIBlockDefinition<DiffProps> = {
  name: 'diff',
  schema,
  Component: DiffBlock,
  skeleton: 'rows',
}
