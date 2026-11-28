import {
  createBudget,
  type Expression,
  type ExpressionBudget,
  ExpressionError,
  type ExpressionScope,
  parseExpression,
  truthy,
  type UIValue,
  valuesEqual,
} from './expression'
import { parsePartialJSON } from './partial-json'
import { compileTemplate, POINT_VARIABLES, type PointTemplate, type Template, unwrapExpressionSource } from './template'

export const BLOCK_LIMITS = {
  computed: 64,
  nodes: 300,
  depth: 8,
  steps: 200_000,
  stateDepth: 4,
  askLength: 160,
} as const

const STRUCTURE_KEYS = new Set(['component', 'id', 'version', 'state', 'computed', 'children', 'visible', 'bind', 'props'])
const CONTROLS = new Set(['slider', 'select', 'segmented', 'switch', 'input', 'tabs'])
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type BlockIssue = { path: string; message: string }

export type NodeSource = {
  component: string
  props: Record<string, unknown>
  children: NodeSource[]
  bind?: string
  visible?: unknown
  closed: boolean
  path: string
}

export type BlockSource = {
  component: string
  id: string
  key: string
  version: number
  state: Record<string, unknown> | undefined
  computed: Record<string, unknown> | undefined
  root: NodeSource
  complete: boolean
  live: boolean
}

export type ParsedBlockSource =
  | { status: 'incomplete' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; block: BlockSource }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function isIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function normalizeVersion(version: unknown): number {
  if (typeof version === 'number' && Number.isFinite(version)) return Math.max(1, Math.trunc(version))
  if (typeof version === 'string') {
    const match = /^v?(\d+)(?:\.\d+)?$/i.exec(version.trim())
    if (match) return Math.max(1, Number.parseInt(match[1] ?? '1', 10))
  }
  return 1
}

function normalizeID(id: unknown): string {
  const text = typeof id === 'number' && Number.isFinite(id) ? String(id) : typeof id === 'string' ? id.trim() : ''
  return BLOCK_ID_PATTERN.test(text) ? text : ''
}

function readNode(value: Record<string, unknown>, path: string, closed: WeakSet<object>): NodeSource {
  const props: Record<string, unknown> = {}
  const legacy = isObject(value.props) ? value.props : undefined
  for (const [key, field] of Object.entries(legacy ?? value)) {
    if (legacy || !STRUCTURE_KEYS.has(key)) setOwn(props, key, field)
  }
  // If flat fields also sit next to `props`, keep them unless already provided in `props`.
  if (legacy) {
    for (const [key, field] of Object.entries(value)) {
      if (!STRUCTURE_KEYS.has(key) && !Object.hasOwn(props, key)) setOwn(props, key, field)
    }
  }
  const children: NodeSource[] = []
  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => {
      if (isObject(child) && typeof child.component === 'string' && child.component !== '') {
        children.push(readNode(child, path ? `${path}.${index}` : String(index), closed))
      }
    })
  }
  return {
    component: typeof value.component === 'string' ? value.component.trim() : '',
    props,
    children,
    bind: typeof value.bind === 'string' && value.bind !== '' ? value.bind : undefined,
    visible: value.visible,
    closed: closed.has(value),
    path,
  }
}

export function parseBlockSource(raw: string, streaming: boolean): ParsedBlockSource {
  let parsed: ReturnType<typeof parsePartialJSON>
  try {
    parsed = parsePartialJSON(raw)
  } catch (error) {
    return { status: 'invalid', message: error instanceof Error ? error.message : 'invalid JSON' }
  }
  const { value, closed } = parsed
  if (!isObject(value) || typeof value.component !== 'string' || !value.component.trim()) {
    if (streaming && !parsed.complete) return { status: 'incomplete' }
    return { status: 'invalid', message: 'expected an object with a component' }
  }
  if (!parsed.complete && parsed.openTail.get(value) === 'component') {
    return { status: 'incomplete' }
  }
  const state = isObject(value.state) ? value.state : undefined
  const computed = isObject(value.computed) ? value.computed : undefined
  const root = readNode(value, '', closed)
  const id = normalizeID(value.id)
  const component = root.component
  const live =
    component === 'panel' ||
    state !== undefined ||
    computed !== undefined ||
    Array.isArray(value.children)
  return {
    status: 'ok',
    block: {
      component,
      id,
      key: id || (parsed.complete ? `auto-${hashText(JSON.stringify(value))}` : ''),
      version: normalizeVersion(value.version),
      state,
      computed,
      root,
      complete: parsed.complete,
      live,
    },
  }
}

export type CompileOptions = {
  rawProps?: (component: string) => readonly string[] | undefined
}

type CompiledValue =
  | { kind: 'static'; value: unknown }
  | { kind: 'template'; template: Template }
  | { kind: 'point'; template: Template }
  | { kind: 'list'; items: CompiledValue[] }
  | { kind: 'object'; fields: [string, CompiledValue][] }

export type CompiledNode = {
  component: string
  path: string
  closed: boolean
  bind?: string
  visible?: Expression
  props: [string, CompiledValue][]
  children: CompiledNode[]
}

export type CompiledBlock = {
  source: BlockSource
  initialState: Record<string, UIValue>
  computed: { name: string; expression?: Expression; value?: UIValue }[]
  root: CompiledNode
  issues: BlockIssue[]
}

export function asUIValue(value: unknown): UIValue | undefined {
  return toUIValue(value, 1)
}

function toUIValue(value: unknown, depth: number): UIValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (depth > BLOCK_LIMITS.stateDepth) return undefined
  if (Array.isArray(value)) {
    const items: UIValue[] = []
    for (const item of value) {
      const json = toUIValue(item, depth + 1)
      if (json === undefined) return undefined
      items.push(json)
    }
    return items
  }
  if (isObject(value)) {
    const result: Record<string, UIValue> = {}
    for (const [key, field] of Object.entries(value)) {
      const json = toUIValue(field, depth + 1)
      if (json === undefined) return undefined
      setOwn(result, key, json)
    }
    return result
  }
  return undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof ExpressionError || error instanceof Error) return error.message
  return String(error)
}

function readInitialState(state: Record<string, unknown> | undefined, issues: BlockIssue[]): Record<string, UIValue> {
  const result: Record<string, UIValue> = {}
  if (!state) return result
  for (const [name, value] of Object.entries(state)) {
    if (!isIdentifier(name)) {
      issues.push({ path: `state.${name}`, message: 'state names must be identifiers' })
      continue
    }
    const json = toUIValue(value, 1)
    if (json === undefined) {
      issues.push({ path: `state.${name}`, message: `state values must be JSON (depth <= ${BLOCK_LIMITS.stateDepth})` })
      continue
    }
    setOwn(result, name, json)
  }
  return result
}

function orderComputed(
  computed: Record<string, unknown> | undefined,
  stateNames: ReadonlySet<string>,
  issues: BlockIssue[],
): CompiledBlock['computed'] {
  if (!computed) return []
  const entries = Object.entries(computed).filter(([name]) => {
    if (!isIdentifier(name)) {
      issues.push({ path: `computed.${name}`, message: 'computed names must be identifiers' })
      return false
    }
    if (stateNames.has(name)) {
      issues.push({ path: `computed.${name}`, message: 'already declared in state' })
      return false
    }
    return true
  })
  if (entries.length > BLOCK_LIMITS.computed) {
    issues.push({ path: 'computed', message: `more than ${BLOCK_LIMITS.computed} entries dropped` })
    entries.length = BLOCK_LIMITS.computed
  }

  const compiled = new Map<string, { expression?: Expression; value?: UIValue }>()
  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      try {
        compiled.set(name, { expression: parseExpression(unwrapExpressionSource(value)) })
      } catch (error) {
        issues.push({ path: `computed.${name}`, message: errorMessage(error) })
        compiled.set(name, { expression: undefined })
      }
      continue
    }
    const json = toUIValue(value, 1)
    if (json === undefined) issues.push({ path: `computed.${name}`, message: 'constant is not a JSON value' })
    compiled.set(name, { value: json ?? null })
  }

  const order: CompiledBlock['computed'] = []
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (name: string, trail: string[]): void => {
    if (done.has(name)) return
    if (visiting.has(name)) {
      issues.push({ path: `computed.${name}`, message: `circular: ${[...trail, name].join(' → ')}` })
      return
    }
    const entry = compiled.get(name)
    if (!entry) return
    visiting.add(name)
    for (const dependency of entry.expression?.variables ?? []) {
      if (compiled.has(dependency)) visit(dependency, [...trail, name])
    }
    visiting.delete(name)
    done.add(name)
    order.push({ name, ...entry })
  }
  for (const name of compiled.keys()) visit(name, [])
  return order
}

type CompileContext = {
  options: CompileOptions
  issues: BlockIssue[]
  nodes: number
  live: boolean
  pointNames: readonly string[]
}

function compileValue(value: unknown, path: string, pointNames: readonly string[], issues: BlockIssue[]): CompiledValue {
  if (typeof value === 'string') {
    try {
      const template = compileTemplate(value)
      if (!template) return { kind: 'static', value }
      const point = template.variables.some((name) => pointNames.includes(name))
      return point ? { kind: 'point', template } : { kind: 'template', template }
    } catch (error) {
      issues.push({ path, message: errorMessage(error) })
      return { kind: 'static', value: undefined }
    }
  }
  if (Array.isArray(value)) {
    return { kind: 'list', items: value.map((item, idx) => compileValue(item, `${path}[${idx}]`, pointNames, issues)) }
  }
  if (isObject(value)) {
    return {
      kind: 'object',
      fields: Object.entries(value).map(([key, field]) => [key, compileValue(field, `${path}.${key}`, pointNames, issues)]),
    }
  }
  return { kind: 'static', value }
}

function compileCondition(value: unknown, path: string, issues: BlockIssue[]): Expression | undefined {
  if (typeof value === 'boolean') return parseExpression(String(value))
  if (typeof value !== 'string') {
    issues.push({ path, message: 'visible must be an expression' })
    return parseExpression('false')
  }
  try {
    return parseExpression(unwrapExpressionSource(value))
  } catch (error) {
    issues.push({ path, message: errorMessage(error) })
    return parseExpression('false')
  }
}

function compileNode(source: NodeSource, depth: number, context: CompileContext): CompiledNode | null {
  if (depth >= BLOCK_LIMITS.depth) {
    context.issues.push({ path: source.path, message: `nesting deeper than ${BLOCK_LIMITS.depth} dropped` })
    return null
  }
  context.nodes += 1
  if (context.nodes > BLOCK_LIMITS.nodes) {
    if (context.nodes === BLOCK_LIMITS.nodes + 1) {
      context.issues.push({ path: source.path, message: `more than ${BLOCK_LIMITS.nodes} nodes dropped` })
    }
    return null
  }
  const raw = new Set(context.options.rawProps?.(source.component) ?? [])
  const props: [string, CompiledValue][] = []
  let bind = source.bind
  for (const [key, value] of Object.entries(source.props)) {
    if (!context.live || raw.has(key)) {
      props.push([key, { kind: 'static', value }])
      continue
    }
    if (key === 'value' && bind === undefined && typeof value === 'string') {
      const bound = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}$/.exec(value)
      if (bound?.[1] && CONTROLS.has(source.component)) {
        bind = bound[1]
        continue
      }
    }
    props.push([key, compileValue(value, `${source.path}.${key}`, context.pointNames, context.issues)])
  }
  let visible: Expression | undefined
  if (context.live && source.visible !== undefined) {
    visible = compileCondition(source.visible, `${source.path}.visible`, context.issues)
  }
  const children: CompiledNode[] = []
  for (const child of source.children) {
    const compiled = compileNode(child, depth + 1, context)
    if (compiled) children.push(compiled)
  }
  return { component: source.component, path: source.path, closed: source.closed, bind, visible, props, children }
}

function staticValue(value: CompiledValue): unknown {
  switch (value.kind) {
    case 'static':
      return value.value
    case 'list': {
      const items: unknown[] = []
      for (const item of value.items) {
        const resolved = staticValue(item)
        if (resolved === undefined) return undefined
        items.push(resolved)
      }
      return items
    }
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [key, field] of value.fields) {
        const resolved = staticValue(field)
        if (resolved === undefined) return undefined
        setOwn(result, key, resolved)
      }
      return result
    }
    default:
      return undefined
  }
}

function controlDefault(node: CompiledNode): UIValue | undefined {
  const prop = (name: string): unknown => {
    const entry = node.props.find(([key]) => key === name)?.[1]
    return entry ? staticValue(entry) : undefined
  }
  switch (node.component) {
    case 'slider': {
      const min = prop('min')
      return typeof min === 'number' ? min : 0
    }
    case 'select':
    case 'segmented':
    case 'tabs': {
      const options = prop(node.component === 'tabs' ? 'items' : 'options')
      const first = Array.isArray(options) ? options[0] : undefined
      if (isObject(first)) return toUIValue(first.value, 1) ?? null
      return toUIValue(first, 1) ?? null
    }
    case 'switch':
      return false
    case 'input':
      return prop('type') === 'number' ? 0 : ''
    default:
      return undefined
  }
}

function implicitState(root: CompiledNode, declared: Readonly<Record<string, UIValue>>): Record<string, UIValue> {
  const result: Record<string, UIValue> = {}
  const walk = (node: CompiledNode) => {
    if (node.bind && isIdentifier(node.bind) && !Object.hasOwn(declared, node.bind) && !Object.hasOwn(result, node.bind)) {
      const value = controlDefault(node)
      if (value !== undefined) setOwn(result, node.bind, value)
    }
    for (const child of node.children) walk(child)
  }
  walk(root)
  return result
}

export function compileBlock(source: BlockSource, options: CompileOptions = {}): CompiledBlock {
  const issues: BlockIssue[] = []
  const initialState = readInitialState(source.state, issues)
  const computed = orderComputed(source.computed, new Set(Object.keys(initialState)), issues)
  const declared = new Set([...Object.keys(initialState), ...computed.map((entry) => entry.name)])
  const pointNames = POINT_VARIABLES.filter((name) => !declared.has(name))
  const context: CompileContext = { options, issues, nodes: 0, live: source.live, pointNames }
  const root = compileNode(source.root, 0, context) ?? {
    component: source.root.component,
    path: source.root.path,
    closed: source.root.closed,
    props: [],
    children: [],
  }
  for (const [name, value] of Object.entries(implicitState(root, initialState))) {
    setOwn(initialState, name, value)
  }
  return { source, initialState, computed, root, issues }
}

export type ResolvedNode = {
  component: string
  path: string
  closed: boolean
  bind?: string
  props: Record<string, unknown>
  children: ResolvedNode[]
}

export type ResolvedBlock = {
  root: ResolvedNode
  values: Readonly<Record<string, UIValue>>
  issues: BlockIssue[]
}

type ResolveContext = {
  values: Readonly<Record<string, UIValue>>
  budget: ExpressionBudget
  issues: BlockIssue[]
}

function scopeOf(
  values: Readonly<Record<string, UIValue>>,
  budget: ExpressionBudget,
  point?: Readonly<Record<string, UIValue>>,
): ExpressionScope {
  return {
    lookup: (name) => {
      if (point && Object.hasOwn(point, name)) return point[name]
      return Object.hasOwn(values, name) ? values[name] : undefined
    },
    budget,
  }
}

function pointTemplate(template: Template, context: ResolveContext, path: string): PointTemplate {
  let reported = false
  return {
    kind: 'point-template',
    source: template.source,
    evaluate: (point) => {
      try {
        return template.evaluate(scopeOf(context.values, context.budget, point))
      } catch (error) {
        if (!reported) {
          reported = true
          context.issues.push({ path, message: errorMessage(error) })
        }
        return null
      }
    },
  }
}

export function isPointTemplate(value: unknown): value is PointTemplate {
  return isObject(value) && value.kind === 'point-template' && typeof value.evaluate === 'function'
}

function resolveValue(value: CompiledValue, path: string, context: ResolveContext): unknown {
  switch (value.kind) {
    case 'static':
      return value.value
    case 'template':
      try {
        return value.template.evaluate(scopeOf(context.values, context.budget), (error) => {
          context.issues.push({ path, message: errorMessage(error) })
        })
      } catch (error) {
        context.issues.push({ path, message: errorMessage(error) })
        return undefined
      }
    case 'point':
      return pointTemplate(value.template, context, path)
    case 'list': {
      const items: unknown[] = []
      for (const [index, item] of value.items.entries()) {
        const resolved = resolveValue(item, `${path}[${index}]`, context)
        if (resolved !== undefined) items.push(resolved)
      }
      return items
    }
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [key, field] of value.fields) {
        const resolved = resolveValue(field, `${path}.${key}`, context)
        if (resolved !== undefined) setOwn(result, key, resolved)
      }
      return result
    }
  }
}

function resolveNode(node: CompiledNode, context: ResolveContext): ResolvedNode | null {
  if (node.visible) {
    try {
      if (!truthy(node.visible.evaluate(scopeOf(context.values, context.budget)))) return null
    } catch (error) {
      context.issues.push({ path: `${node.path}.visible`, message: errorMessage(error) })
      return null
    }
  }
  const props: Record<string, unknown> = {}
  for (const [key, value] of node.props) {
    const resolved = resolveValue(value, `${node.path}.${key}`, context)
    if (resolved !== undefined) setOwn(props, key, resolved)
  }
  const children: ResolvedNode[] = []
  for (const child of node.children) {
    const resolved = resolveNode(child, context)
    if (resolved) children.push(resolved)
  }
  return { component: node.component, path: node.path, closed: node.closed, bind: node.bind, props, children }
}

export function resolveBlock(block: CompiledBlock, state: Readonly<Record<string, UIValue>>): ResolvedBlock {
  const issues: BlockIssue[] = []
  const budget = createBudget(BLOCK_LIMITS.steps)
  const values: Record<string, UIValue> = { ...state }
  for (const entry of block.computed) {
    if (entry.expression === undefined) {
      if (entry.value !== undefined) setOwn(values, entry.name, entry.value)
      continue
    }
    try {
      setOwn(values, entry.name, entry.expression.evaluate(scopeOf(values, budget)))
    } catch (error) {
      issues.push({ path: `computed.${entry.name}`, message: errorMessage(error) })
    }
  }
  const context: ResolveContext = { values, budget, issues }
  const root = resolveNode(block.root, context) ?? { ...block.root, props: {}, children: [] }
  return { root, values, issues }
}

function sameShape(declared: UIValue, value: UIValue): boolean {
  if (declared === null || value === null) return true
  if (Array.isArray(declared)) return Array.isArray(value)
  return typeof declared === typeof value && Array.isArray(declared) === Array.isArray(value)
}

export function mergeState(
  initial: Readonly<Record<string, UIValue>>,
  saved: Readonly<Record<string, unknown>> | undefined,
): Record<string, UIValue> {
  const result: Record<string, UIValue> = { ...initial }
  if (!saved) return result
  for (const [name, value] of Object.entries(saved)) {
    if (!Object.hasOwn(initial, name)) continue
    const json = toUIValue(value, 1)
    const declared = initial[name] ?? null
    if (json !== undefined && sameShape(declared, json)) setOwn(result, name, json)
  }
  return result
}

export function stateDiff(
  initial: Readonly<Record<string, UIValue>>,
  state: Readonly<Record<string, UIValue>>,
): Record<string, UIValue> | undefined {
  const diff: Record<string, UIValue> = {}
  for (const [name, value] of Object.entries(state)) {
    if (Object.hasOwn(initial, name) && !valuesEqual(value, initial[name] ?? null)) {
      setOwn(diff, name, value)
    }
  }
  return Object.keys(diff).length > 0 ? diff : undefined
}

export type ResolvedAction =
  | { kind: 'set'; patch: Record<string, UIValue> }
  | { kind: 'ask'; text: string }
  | { kind: 'copy'; text: string }

export function readAction(
  props: Readonly<Record<string, unknown>>,
  stateNames: ReadonlySet<string>,
): ResolvedAction | undefined {
  if (typeof props.ask === 'string' && props.ask.trim() !== '') {
    return { kind: 'ask', text: props.ask.trim().slice(0, BLOCK_LIMITS.askLength) }
  }
  if (typeof props.copy === 'string' && props.copy !== '') {
    return { kind: 'copy', text: props.copy }
  }
  if (isObject(props.set)) {
    const patch: Record<string, UIValue> = {}
    for (const [name, value] of Object.entries(props.set)) {
      const json = toUIValue(value, 1)
      if (stateNames.has(name) && json !== undefined) setOwn(patch, name, json)
    }
    return Object.keys(patch).length > 0 ? { kind: 'set', patch } : undefined
  }
  return undefined
}
