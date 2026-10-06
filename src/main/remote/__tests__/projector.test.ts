import { describe, expect, it } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { TurnPatchSchema, TurnSchema } from '@shared/remote'
import type { HostTimelineItem } from '../host-port'
import { LiveProjector, projectHistory } from '../projector'

const noCard = () => undefined
const base = (n: number) => ({ seq: n, workspaceId: '/w', sessionFile: '/w/s.jsonl', timestamp: 1000 + n })

const history: HostTimelineItem[] = [
  { id: 'h1', type: 'user-message', text: '修一下登录', sessionEntryId: 'e1', timestamp: 1_000 },
  { id: 'h2', type: 'assistant-message', text: '先看代码。', thinkingText: 'look at auth', sessionEntryId: 'e2', timestamp: 2_000 },
  { id: 'h3', type: 'tool-call', toolCallId: 'c1', toolName: 'read', toolArgs: { path: 'src/a.ts' }, toolOutput: 'export {}', timestamp: 2_000 },
  {
    id: 'h4',
    type: 'tool-call',
    toolCallId: 'c2',
    toolName: 'edit',
    toolArgs: { path: 'src/a.ts', edits: [{ oldText: 'a\nb', newText: 'a\nb\nc' }] },
    toolOutput: 'ok',
    timestamp: 3_000,
  },
  { id: 'h5', type: 'tool-call', toolCallId: 'c3', toolName: 'bash', toolArgs: { command: 'npm test' }, toolOutput: 'FAIL', isError: true, timestamp: 4_000 },
  { id: 'h6', type: 'assistant-message', text: '修好了。', sessionEntryId: 'e6', timestamp: 9_000 },
  { id: 'h7', type: 'user-message', text: '谢谢', sessionEntryId: 'e7', timestamp: 10_000 },
  { id: 'h8', type: 'assistant-message', text: '', incomplete: true, stopReason: 'aborted', timestamp: 11_000 },
]

describe('projectHistory', () => {
  const turns = projectHistory(history, noCard, { model: 'm/x', thinking: 'high' })

  it('opens one turn per user message with a stable anchor', () => {
    expect(turns.map((t) => t.anchor)).toEqual(['e1', 'e7'])
    for (const t of turns) expect(TurnSchema.safeParse(t).success).toBe(true)
  })

  it('folds pre-tool text into prose and keeps the trailing text as the answer', () => {
    const t = turns[0]
    expect(t.steps.map((s) => s.kind)).toEqual(['thinking', 'prose', 'tool', 'tool', 'tool'])
    expect(t.answer).toBe('修好了。')
    expect(t.status).toBe('done')
    expect(t.durationMs).toBe(8_000)
  })

  it('counts by category, failures and file stats', () => {
    const t = turns[0]
    expect(t.activity.counts).toMatchObject({ read: 1, edit: 1, run: 1, think: 1 })
    expect(t.activity.failed).toBe(1)
    expect(t.files).toEqual([{ path: 'src/a.ts', add: 3, del: 2 }])
  })

  it('marks an interrupted last turn as aborted and puts meta on the last turn', () => {
    expect(turns[1].status).toBe('aborted')
    expect(turns[1].meta).toEqual({ model: 'm/x', thinking: 'high' })
  })
})

describe('LiveProjector', () => {
  function run(events: AppEvent[]) {
    let now = 0
    const p = new LiveProjector(noCard, () => (now += 10))
    const patches = events.flatMap((e) => p.apply(e))
    patches.forEach((b, i) => expect(TurnPatchSchema.safeParse({ ...b, seq: i + 1 }).success, JSON.stringify(b)).toBe(true))
    return { p, patches }
  }

  it('projects the todo widget into session state and clears it', () => {
    const widget = (phase: 'set' | 'clear', items: unknown[] = []) =>
      ({
        ...base(1),
        type: 'extension_widget',
        phase,
        widgetKey: 'todo',
        adapterId: 'pi-todo',
        protocol: 'todo-list-v1',
        ...(phase === 'set' ? { state: { adapterId: 'pi-todo', widgetKey: 'todo', protocol: 'todo-list-v1', title: '待办', payload: { items }, updatedAt: 1 } } : {}),
      }) as unknown as AppEvent
    const { p } = run([widget('set', [{ id: '1', text: '写测试', status: 'in_progress', priority: 'high' }, { id: '2', text: '提交', status: 'pending' }])])
    expect(p.sessionState.todo).toEqual({ title: '待办', items: [{ id: '1', text: '写测试', status: 'in_progress', priority: 'high' }, { id: '2', text: '提交', status: 'pending' }] })
    p.apply(widget('clear'))
    expect(p.sessionState.todo).toBeNull()
  })

  const events: AppEvent[] = [
    { ...base(1), type: 'run', phase: 'running' },
    { ...base(2), type: 'message', role: 'user', phase: 'start', text: '跑测试' },
    { ...base(3), type: 'message', role: 'user', phase: 'end', sessionEntryId: 'e9' },
    { ...base(4), type: 'message', role: 'assistant', phase: 'delta', text: 'think ', contentKind: 'thinking' },
    { ...base(5), type: 'message', role: 'assistant', phase: 'delta', text: 'more', contentKind: 'thinking' },
    { ...base(6), type: 'message', role: 'assistant', phase: 'delta', text: '先跑一下。', contentKind: 'text' },
    { ...base(7), type: 'tool', toolCallId: 't1', toolName: 'bash', phase: 'start', input: { command: 'npm test' } },
    { ...base(8), type: 'tool', toolCallId: 't1', toolName: 'bash', phase: 'update', output: 'running 3 tests' },
    { ...base(9), type: 'tool', toolCallId: 't1', toolName: 'bash', phase: 'end', output: { content: [{ type: 'text', text: '3 passed' }] }, isError: false },
    { ...base(10), type: 'message', role: 'assistant', phase: 'delta', text: '通过', contentKind: 'text' },
    { ...base(11), type: 'message', role: 'assistant', phase: 'delta', text: '了。', contentKind: 'text' },
    { ...base(12), type: 'run', phase: 'idle', settled: true },
  ]

  it('streams thinking and answer as appends, promotes text before a tool, settles', () => {
    const { p, patches } = run(events)
    const ops = patches.map((x) => x.op)
    expect(ops).toContain('turn.promote')
    expect(ops.filter((o) => o === 'text.append').length).toBe(4)
    expect(ops[ops.length - 2]).toBe('turn.settle')
    const t = p.liveTurn!
    expect(t.anchor).toBe('e9')
    expect(t.status).toBe('done')
    expect(t.answer).toBe('通过了。')
    expect(t.steps.map((s) => s.kind)).toEqual(['thinking', 'prose', 'tool'])
    expect(t.steps[0]).toMatchObject({ kind: 'thinking', text: 'think more' })
    expect((t.steps[0] as { ms?: number }).ms).toBeGreaterThan(0)
    expect(t.steps[2]).toMatchObject({ kind: 'tool', status: 'ok', node: { template: 'bash', title: 'npm test', preview: '3 passed' } })
    expect(p.sessionState.running).toBe(false)
  })

  it('tool update keeps the args from start', () => {
    const { patches } = run(events.slice(0, 8))
    const upd = patches.filter((x) => x.op === 'step.upsert').pop() as { step: { node: { title: string; status: string } } }
    expect(upd.step.node).toMatchObject({ title: 'npm test', status: 'running' })
  })

  it('produces the same turn shape as history projection', () => {
    const { p } = run(events)
    const live = p.liveTurn!
    const hist = projectHistory(
      [
        { id: 'a', type: 'user-message', text: '跑测试', sessionEntryId: 'e9', timestamp: 1 },
        { id: 'b', type: 'assistant-message', text: '先跑一下。', thinkingText: 'think more', timestamp: 2 },
        { id: 'c', type: 'tool-call', toolCallId: 't1', toolName: 'bash', toolArgs: { command: 'npm test' }, toolOutput: '3 passed', timestamp: 3 },
        { id: 'd', type: 'assistant-message', text: '通过了。', timestamp: 4 },
      ],
      noCard,
    )[0]
    const shape = (t: typeof live) => ({ kinds: t.steps.map((s) => s.kind), answer: t.answer, counts: t.activity.counts, status: t.status, tool: t.steps[2]?.kind === 'tool' ? t.steps[2].node.template : null })
    expect(shape(live)).toEqual(shape(hist))
  })

  it('a steer message mid-run settles the open turn and opens another', () => {
    const { p, patches } = run([
      ...events.slice(0, 7),
      { ...base(20), type: 'message', role: 'user', phase: 'start', text: '顺便看下 lint' },
    ])
    const settles = patches.filter((x) => x.op === 'turn.settle')
    expect(settles).toHaveLength(1)
    expect(p.liveTurn!.user.text).toBe('顺便看下 lint')
  })

  it('failure and abort carry the agent_error text; running tools become errors', () => {
    const { p } = run([
      ...events.slice(0, 7),
      { ...base(30), type: 'agent_error', text: 'rate limited', kind: 'error' },
      { ...base(31), type: 'run', phase: 'failed', settled: true },
    ])
    expect(p.liveTurn!.status).toBe('failed')
    expect(p.liveTurn!.error).toEqual({ kind: 'error', text: 'rate limited' })
    expect(p.liveTurn!.steps.find((s) => s.kind === 'tool')).toMatchObject({ status: 'error' })
    const aborted = run([...events.slice(0, 3), { ...base(40), type: 'run', phase: 'cancelled', settled: true }])
    expect(aborted.p.liveTurn!.status).toBe('aborted')
  })

  it('queue and model state become session.state patches', () => {
    const { p } = run([
      { ...base(1), type: 'queue', steering: [], followUp: ['更新 CHANGELOG'] },
      { ...base(2), type: 'run', phase: 'state', model: 'a/b', thinkingLevel: 'low', availableThinkingLevels: ['off', 'low'] },
    ])
    expect(p.sessionState).toEqual({ running: false, queue: { steering: [], followUp: ['更新 CHANGELOG'] }, model: 'a/b', thinking: 'low', availableThinking: ['off', 'low'] })
  })
})
