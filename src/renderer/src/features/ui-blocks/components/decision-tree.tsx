import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, RotateCcw, Undo2 } from '@renderer/components/icons'
import { useBlockState } from '../block-state'
import { BlockFrame } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'

type TreeOption = { label: string; next: string }
type TreeNode = { id: string; text: string; detail?: string; options?: TreeOption[] }
type DecisionTreeProps = { title?: string; start?: string; nodes: TreeNode[] }

const schema = v.object<DecisionTreeProps>({
  title: v.optional(v.string()),
  start: v.optional(v.string()),
  nodes: v.array(
    v.object<TreeNode>({
      id: v.string(),
      text: v.string(),
      detail: v.optional(v.string()),
      options: v.optional(v.array(v.object<TreeOption>({ label: v.string(), next: v.string() }))),
    }),
    { min: 1, max: 200 },
  ),
})

/** One step taken: the node shown and the option chosen there. */
type Step = { node: string; choice: number }

function DecisionTree({ props, blockKey, animate }: UIBlockComponentProps<DecisionTreeProps>) {
  const { t } = useTranslation()
  const byId = useMemo(() => new Map(props.nodes.map((node) => [node.id, node])), [props.nodes])
  const startId = props.start && byId.has(props.start) ? props.start : props.nodes[0].id
  const [steps, setSteps] = useBlockState<Step[]>(blockKey, 'steps', [])

  // Replay the recorded choices; stop at the first one that no longer resolves.
  let currentId = startId
  const trail: Array<{ node: TreeNode; label: string }> = []
  for (const step of steps) {
    const node = byId.get(step.node)
    const option = node?.options?.[step.choice]
    if (!node || step.node !== currentId || !option || !byId.has(option.next)) break
    trail.push({ node, label: option.label })
    currentId = option.next
  }
  const current = byId.get(currentId) ?? props.nodes[0]
  const conclusion = !current.options || current.options.length === 0

  // Step transitions animate only after the user starts navigating (history renders still).
  const interacted = useRef(false)
  const go = (next: Step[]) => {
    interacted.current = true
    setSteps(next)
  }
  const choose = (index: number) => go([...steps.slice(0, trail.length), { node: current.id, choice: index }])
  const back = () => go(steps.slice(0, Math.max(0, trail.length - 1)))

  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        trail.length > 0 ? (
          <>
            <button type="button" className="uib-icon-btn" onClick={back} aria-label={t('timeline:uiBlock.back')} title={t('timeline:uiBlock.back')}>
              <Undo2 />
            </button>
            <button type="button" className="uib-icon-btn" onClick={() => go([])} aria-label={t('timeline:uiBlock.reset')} title={t('timeline:uiBlock.reset')}>
              <RotateCcw />
            </button>
          </>
        ) : null
      }
    >
      {trail.length > 0 ? (
        <ol className="uib-trail">
          {trail.map((entry, index) => (
            <li key={index}>
              <button type="button" className="uib-trail-step" onClick={() => go(steps.slice(0, index))} title={entry.node.text}>
                {entry.label}
              </button>
              {index < trail.length - 1 ? <ChevronRight className="uib-trail-sep" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div
        key={current.id}
        className={interacted.current ? 'uib-step uib-step-in' : 'uib-step'}
        data-conclusion={conclusion || undefined}
      >
        {conclusion ? <div className="uib-step-kicker">{t('timeline:uiBlock.conclusion')}</div> : null}
        <div className="uib-step-text">{current.text}</div>
        {current.detail ? <p className="uib-step-detail">{current.detail}</p> : null}
        {conclusion ? (
          trail.length > 0 ? (
            <button type="button" className="uib-btn" onClick={() => go([])}>
              {t('timeline:uiBlock.restart')}
            </button>
          ) : null
        ) : (
          <div className="uib-options">
            {current.options!.map((option, index) => {
              const broken = !byId.has(option.next)
              return (
                <button
                  key={`${option.label}-${index}`}
                  type="button"
                  className="uib-option"
                  disabled={broken}
                  title={broken ? t('timeline:uiBlock.brokenLink', { id: option.next }) : undefined}
                  onClick={() => choose(index)}
                >
                  <span>{option.label}</span>
                  <ChevronRight className="uib-option-chevron" aria-hidden />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </BlockFrame>
  )
}

export const decisionTreeDefinition: UIBlockDefinition<DecisionTreeProps> = {
  name: 'decision-tree',
  schema,
  Component: DecisionTree,
  skeleton: 'block',
}
