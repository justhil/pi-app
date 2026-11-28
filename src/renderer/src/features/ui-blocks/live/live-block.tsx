import { Component, memo, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  compileBlock,
  expandPointProps,
  isUIContainer,
  isUIPrimitive,
  mergeState,
  resolveBlock,
  stateDiff,
  takeWhere,
  WHERE_LIST_PROP,
  type BlockIssue,
  type BlockSource,
  type CompileOptions,
  type ResolvedNode,
  type UIValue,
} from '../engine'
import { useBlockState } from '../block-state'
import { UI_BLOCK_REGISTRY } from '../registry'
import { validate } from '../schema'
import { LiveBlockContext, type LiveBlockContextValue, useLiveBlock } from './live-context'
import { LivePrimitive } from './live-primitives'

const NO_OVERRIDES: Record<string, UIValue> = {}

const LIVE_COMPILE_OPTIONS: CompileOptions = {
  rawProps: (component) => (component === 'diff' ? ['before', 'after'] : undefined),
}

class NodeBoundary extends Component<{ resetKey: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey: unknown }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export const LiveBlock = memo(function LiveBlock({
  block,
  blockKey,
  streaming,
}: {
  block: BlockSource
  blockKey: string
  streaming: boolean
}) {
  const compiled = useMemo(() => compileBlock(block, LIVE_COMPILE_OPTIONS), [block])
  const [overrides, setOverrides] = useBlockState<Record<string, UIValue>>(blockKey, 'live-state', NO_OVERRIDES)
  const initialRef = useRef(compiled.initialState)
  initialRef.current = compiled.initialState

  const state = useMemo(() => mergeState(compiled.initialState, overrides), [compiled.initialState, overrides])
  const resolved = useMemo(() => resolveBlock(compiled, state), [compiled, state])
  const stateNames = useMemo(() => new Set(Object.keys(compiled.initialState)), [compiled.initialState])

  const update = useCallback(
    (patch: Record<string, UIValue>) => {
      setOverrides((current) => {
        const declared = initialRef.current
        return stateDiff(declared, mergeState(declared, { ...current, ...patch })) ?? NO_OVERRIDES
      })
    },
    [setOverrides],
  )

  const reset = useCallback(() => {
    setOverrides(NO_OVERRIDES)
  }, [setOverrides])

  const changed = useMemo(() => stateDiff(compiled.initialState, state) !== undefined, [compiled.initialState, state])

  const context = useMemo<LiveBlockContextValue>(
    () => ({
      blockKey,
      streaming,
      state,
      values: resolved.values,
      stateNames,
      update,
      changed,
      reset,
      renderNode: (node) => <LiveNode node={node} />,
    }),
    [blockKey, changed, reset, resolved.values, state, stateNames, streaming, update],
  )

  return (
    <LiveBlockContext.Provider value={context}>
      <div className="uib-frame uib-live-frame">
        <LiveNode node={resolved.root} />
      </div>
    </LiveBlockContext.Provider>
  )
})

function LiveNode({ node }: { node: ResolvedNode }) {
  const { streaming } = useLiveBlock()
  if (streaming && !node.closed && !isUIContainer(node.component)) {
    return <span className="uib-sk-box" style={{ height: 32 }} />
  }
  return (
    <NodeBoundary resetKey={node}>
      {isUIPrimitive(node.component) ? <LivePrimitive node={node} /> : <LiveCatalogNode node={node} />}
    </NodeBoundary>
  )
}

function LiveCatalogNode({ node }: { node: ResolvedNode }) {
  const { blockKey } = useLiveBlock()
  const definition = UI_BLOCK_REGISTRY.get(node.component)
  if (!definition) {
    return <p className="uib-live-notice">未知组件：{node.component}</p>
  }
  const issues: BlockIssue[] = []
  const { props, where } = takeWhere(node.component, expandPointProps(node.component, node.props, issues), issues)
  const validation = validate(definition.schema, props)
  if (!validation.ok) {
    return <p className="uib-live-notice">组件 {node.component} 参数无效</p>
  }
  let finalProps = validation.value as Record<string, unknown>
  if (where) {
    const listProp = WHERE_LIST_PROP[node.component] ?? ''
    const list = finalProps[listProp]
    const kept = Array.isArray(list) ? list.filter((row, index) => where(row, index)) : []
    if (kept.length === 0) {
      return <p className="uib-live-notice">无匹配数据</p>
    }
    finalProps = { ...finalProps, [listProp]: kept }
  }
  const Rendered = definition.Component
  const nestedKey = `${blockKey}-n${node.path.replaceAll('.', '-') || 'root'}`
  return (
    <div className="uib-live-catalog-wrap">
      <Rendered props={finalProps} blockKey={nestedKey} animate={false} />
    </div>
  )
}
