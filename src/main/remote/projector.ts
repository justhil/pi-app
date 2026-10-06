import type { AppEvent } from '@shared/app-events'
import type { FileStat, SessionState, Step, Turn, TurnPatch, TurnStatus } from '@shared/remote'
import { emptyActivityCounts } from '@shared/remote'
import type { ToolCardDef } from '../../extension-compat/adapter-schema'
import type { HostTimelineItem } from './host-port'
import { buildRenderNode, diffStats, toolCategory, type ToolCallInput } from './render-node'

/**
 * Pi history rows / live AppEvents → turn-centric model (see parent design §3).
 * One user message opens a turn; thinking and tools become steps; assistant text after the
 * last tool is the answer, and is promoted to a `prose` step once more activity follows.
 * History and live projection share TurnBuilder so both produce identical shapes.
 */

export type PatchBody = TurnPatch extends infer P ? (P extends { seq: number } ? Omit<P, 'seq'> : never) : never
type ToolCardLookup = (toolName: string) => ToolCardDef | undefined

export class TurnBuilder {
  readonly turn: Turn
  private stepSeq = 0
  private readonly fileMap = new Map<string, FileStat>()
  private readonly toolSteps = new Map<string, number>()
  private thinkingStartedAt: number | null = null

  constructor(id: string, anchor: string, userText: string, startedAt: number | undefined, private readonly toolCard: ToolCardLookup) {
    this.turn = {
      id,
      anchor,
      status: 'running',
      ...(startedAt ? { startedAt } : {}),
      user: { text: userText },
      activity: { counts: emptyActivityCounts(), failed: 0 },
      steps: [],
      answer: '',
      files: [],
    }
  }

  private nextStepId(): string {
    return `${this.turn.id}:s${++this.stepSeq}`
  }

  private recount(): void {
    const counts = emptyActivityCounts()
    let failed = 0
    for (const s of this.turn.steps) {
      if (s.kind === 'thinking') counts.think++
      else if (s.kind === 'tool') {
        counts[s.category]++
        if (s.status === 'error') failed++
      }
    }
    this.turn.activity = { ...this.turn.activity, counts, failed }
  }

  setAnchor(anchor: string): void {
    this.turn.anchor = anchor
  }

  /** Move the current answer into a prose step (more activity follows it). */
  promoteAnswer(): Extract<Step, { kind: 'prose' }> | null {
    const text = this.turn.answer
    if (!text.trim()) {
      this.turn.answer = ''
      return null
    }
    const step = { id: this.nextStepId(), kind: 'prose' as const, text }
    this.turn.steps = [...this.turn.steps, step]
    this.turn.answer = ''
    return step
  }

  /** Append thinking; returns the step and whether it was created. */
  appendThinking(delta: string, now?: number): { step: Extract<Step, { kind: 'thinking' }>; created: boolean; promoted: Extract<Step, { kind: 'prose' }> | null } {
    const promoted = this.turn.answer ? this.promoteAnswer() : null
    const last = this.turn.steps[this.turn.steps.length - 1]
    if (last?.kind === 'thinking' && !promoted) {
      const step = { ...last, text: last.text + delta }
      this.turn.steps = [...this.turn.steps.slice(0, -1), step]
      return { step, created: false, promoted }
    }
    if (now) this.thinkingStartedAt = now
    const step = { id: this.nextStepId(), kind: 'thinking' as const, text: delta }
    this.turn.steps = [...this.turn.steps, step]
    this.recount()
    return { step, created: true, promoted }
  }

  /** Close the running thinking step (live only), recording its duration. */
  closeThinking(now: number): Extract<Step, { kind: 'thinking' }> | null {
    if (this.thinkingStartedAt == null) return null
    const last = this.turn.steps[this.turn.steps.length - 1]
    const startedAt = this.thinkingStartedAt
    this.thinkingStartedAt = null
    if (last?.kind !== 'thinking') return null
    const ms = Math.max(0, now - startedAt)
    const step = { ...last, ms }
    this.turn.steps = [...this.turn.steps.slice(0, -1), step]
    this.turn.activity = { ...this.turn.activity, thinkingMs: (this.turn.activity.thinkingMs ?? 0) + ms }
    return step
  }

  appendAnswer(delta: string): void {
    this.turn.answer += delta
  }

  /** Whole assistant message text (history); consecutive messages without tools are joined. */
  addAnswerText(text: string): void {
    if (!text.trim()) return
    this.turn.answer = this.turn.answer ? `${this.turn.answer}\n\n${text}` : text
  }

  upsertTool(toolCallId: string, input: ToolCallInput): { step: Extract<Step, { kind: 'tool' }>; promoted: Extract<Step, { kind: 'prose' }> | null } {
    const card = this.toolCard(input.toolName)
    const idx = toolCallId ? this.toolSteps.get(toolCallId) : undefined
    const existing = idx !== undefined ? this.turn.steps[idx] : undefined
    const promoted = existing ? null : this.promoteAnswer()
    const prev = existing?.kind === 'tool' ? existing : undefined
    const merged: ToolCallInput = {
      ...input,
      args: input.args ?? (prev ? (this.argsByCall.get(toolCallId) as unknown) : undefined),
    }
    if (input.args !== undefined && toolCallId) this.argsByCall.set(toolCallId, input.args)
    const node = buildRenderNode(merged, card)
    const step = {
      id: prev?.id ?? this.nextStepId(),
      kind: 'tool' as const,
      toolCallId: toolCallId || prev?.toolCallId || `anon-${this.stepSeq}`,
      toolName: input.toolName,
      category: toolCategory(input.toolName, card),
      node,
      status: node.status,
    }
    if (idx !== undefined) {
      const steps = this.turn.steps.slice()
      steps[idx] = step
      this.turn.steps = steps
    } else {
      this.turn.steps = [...this.turn.steps, step]
      if (toolCallId) this.toolSteps.set(toolCallId, this.turn.steps.length - 1)
    }
    if (input.phase === 'end' && !input.isError) this.recordFile(input.toolName, merged.args, input.details)
    this.recount()
    return { step, promoted }
  }

  private readonly argsByCall = new Map<string, unknown>()

  private recordFile(toolName: string, args: unknown, details: unknown): void {
    const stats = diffStats(toolName, args, details)
    const path = typeof (args as { path?: unknown })?.path === 'string' ? (args as { path: string }).path : ''
    if (!stats || !path) return
    const prev = this.fileMap.get(path) ?? { path, add: 0, del: 0 }
    this.fileMap.set(path, { path, add: prev.add + stats.add, del: prev.del + stats.del })
    this.turn.files = [...this.fileMap.values()]
  }

  setLive(stepId: string | undefined): void {
    const { live: _drop, ...rest } = this.turn.activity
    void _drop
    this.turn.activity = stepId ? { ...rest, live: stepId } : rest
  }

  settle(status: TurnStatus, endedAt: number | undefined, error?: Turn['error']): void {
    // Tools still marked running when the turn ends were interrupted.
    this.turn.steps = this.turn.steps.map((s) =>
      s.kind === 'tool' && s.status === 'running' ? { ...s, status: 'error' as const, node: { ...s.node, status: 'error' as const } } : s,
    )
    this.recount()
    this.setLive(undefined)
    this.turn.status = status
    if (endedAt && this.turn.startedAt) this.turn.durationMs = Math.max(0, endedAt - this.turn.startedAt)
    if (error) this.turn.error = error
    else delete this.turn.error
  }

  snapshot(): Turn {
    return structuredClone(this.turn)
  }
}

// ── History ────────────────────────────────────────────────────────────────

/** Project a full branch history into turns (oldest first). */
export function projectHistory(items: readonly HostTimelineItem[], toolCard: ToolCardLookup, meta?: { model?: string; thinking?: string }): Turn[] {
  const turns: Turn[] = []
  let current: TurnBuilder | null = null
  let lastTs: number | undefined
  let lastAssistant: HostTimelineItem | null = null

  const finish = () => {
    if (!current) return
    const stop = lastAssistant?.stopReason
    const status: TurnStatus = lastAssistant?.incomplete ? (stop === 'aborted' ? 'aborted' : 'failed') : stop === 'aborted' ? 'aborted' : stop === 'error' ? 'failed' : 'done'
    current.settle(status, lastTs, status === 'done' ? undefined : { kind: status === 'aborted' ? 'aborted' : 'error', text: stop || 'interrupted' })
    turns.push(current.snapshot())
    current = null
    lastAssistant = null
  }

  const open = (item: HostTimelineItem | null) => {
    const anchor = item?.sessionEntryId || item?.id || `orphan-${turns.length}`
    current = new TurnBuilder(`t-${anchor}`, anchor, item?.text ?? '', item?.timestamp, toolCard)
  }

  for (const item of items) {
    if (item.type === 'user-message') {
      finish()
      open(item)
      lastTs = item.timestamp
      continue
    }
    if (item.type !== 'assistant-message' && item.type !== 'tool-call') continue
    if (!current) open(null)
    const b = current as unknown as TurnBuilder
    if (item.timestamp) lastTs = item.timestamp
    if (item.type === 'assistant-message') {
      lastAssistant = item
      if (item.thinkingText?.trim()) b.appendThinking(item.thinkingText)
      if (item.text) b.addAnswerText(item.text)
    } else {
      b.upsertTool(item.toolCallId || '', {
        toolName: item.toolName || 'tool',
        args: item.toolArgs,
        output: item.toolOutput,
        details: item.toolDetails,
        isError: item.isError,
        phase: 'end',
      })
    }
  }
  finish()
  if (meta && turns.length) {
    const last = turns[turns.length - 1]
    last.meta = { ...(meta.model ? { model: meta.model } : {}), ...(meta.thinking ? { thinking: meta.thinking } : {}) }
  }
  return turns
}

// ── Live ───────────────────────────────────────────────────────────────────

/**
 * Per-session live projector. Feed it the session's AppEvents in order; it returns the
 * patches to broadcast (without `seq`; the hub stamps them).
 */
export class LiveProjector {
  private builder: TurnBuilder | null = null
  private liveSeq = 0
  private pendingError: Turn['error'] | undefined
  private state: SessionState = { running: false }

  constructor(
    private readonly toolCard: ToolCardLookup,
    private readonly now: () => number = Date.now,
  ) {}

  get liveTurn(): Turn | null {
    return this.builder ? this.builder.snapshot() : null
  }

  get sessionState(): SessionState {
    return structuredClone(this.state)
  }

  /** Forget the in-memory turn (after a rewind the history on disk is the truth). */
  clearLiveTurn(): void {
    this.builder = null
    this.pendingError = undefined
  }

  /** Seed state from the desktop when a session is first watched. */
  seedState(state: SessionState): void {
    this.state = { ...this.state, ...state }
  }

  private startTurn(userText: string): PatchBody[] {
    const out: PatchBody[] = []
    if (this.builder && this.builder.turn.status === 'running') {
      // A steer message mid-run opens a new turn, exactly like history projection does.
      this.builder.settle('done', this.now())
      out.push({ op: 'turn.settle', turnId: this.builder.turn.id, status: 'done', durationMs: this.builder.turn.durationMs, files: this.builder.turn.files })
    }
    const id = `live:${++this.liveSeq}-${this.now().toString(36)}`
    this.builder = new TurnBuilder(id, id, userText, this.now(), this.toolCard)
    this.pendingError = undefined
    out.push({ op: 'turn.upsert', turn: this.builder.snapshot() })
    return out
  }

  private ensureTurn(out: PatchBody[]): TurnBuilder {
    if (!this.builder || this.builder.turn.status !== 'running') out.push(...this.startTurn(''))
    return this.builder as TurnBuilder
  }

  private stepPatch(b: TurnBuilder, step: Step): PatchBody {
    const a = b.turn.activity
    return { op: 'step.upsert', turnId: b.turn.id, step, counts: a.counts, failed: a.failed, ...(a.live ? { live: a.live } : {}) }
  }

  private setState(next: Partial<SessionState>): PatchBody {
    this.state = { ...this.state, ...next }
    return { op: 'session.state', state: this.sessionState }
  }

  apply(event: AppEvent): PatchBody[] {
    const out: PatchBody[] = []
    switch (event.type) {
      case 'message': {
        if (event.role === 'user') {
          if (event.phase === 'start') out.push(...this.startTurn(event.text ?? ''))
          else if (event.phase === 'end' && event.sessionEntryId && this.builder) {
            this.builder.setAnchor(event.sessionEntryId)
            out.push({ op: 'turn.upsert', turn: this.builder.snapshot() })
          }
          break
        }
        if (event.role !== 'assistant' || event.phase !== 'delta' || !event.text) break
        const b = this.ensureTurn(out)
        if (event.contentKind === 'thinking') {
          const r = b.appendThinking(event.text, this.now())
          if (r.promoted) out.push({ op: 'turn.promote', turnId: b.turn.id, step: r.promoted })
          if (r.created) {
            b.setLive(r.step.id)
            out.push(this.stepPatch(b, r.step))
          } else {
            out.push({ op: 'text.append', turnId: b.turn.id, ref: r.step.id, delta: event.text })
          }
        } else {
          const closed = b.closeThinking(this.now())
          if (closed) out.push(this.stepPatch(b, closed))
          b.appendAnswer(event.text)
          out.push({ op: 'text.append', turnId: b.turn.id, ref: 'answer', delta: event.text })
        }
        break
      }
      case 'tool': {
        const b = this.ensureTurn(out)
        const closed = b.closeThinking(this.now())
        if (closed) out.push(this.stepPatch(b, closed))
        const r = b.upsertTool(event.toolCallId, {
          toolName: event.toolName,
          args: event.input,
          output: event.output,
          details: event.details,
          isError: event.isError,
          phase: event.phase,
          statusLine: event.phase === 'update' && typeof event.output === 'string' ? event.output : undefined,
        })
        if (r.promoted) out.push({ op: 'turn.promote', turnId: b.turn.id, step: r.promoted })
        b.setLive(event.phase === 'end' ? undefined : r.step.id)
        out.push(this.stepPatch(b, r.step))
        break
      }
      case 'agent_error': {
        this.pendingError = { kind: event.kind ?? 'error', text: event.text }
        break
      }
      case 'run': {
        if (event.phase === 'running' || event.phase === 'started') {
          if (!this.state.running) out.push(this.setState({ running: true }))
          break
        }
        if (event.phase === 'state') {
          out.push(
            this.setState({
              ...(event.model ? { model: event.model } : {}),
              ...(event.thinkingLevel ? { thinking: event.thinkingLevel } : {}),
              ...(event.availableThinkingLevels ? { availableThinking: event.availableThinkingLevels } : {}),
            }),
          )
          break
        }
        if (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled') {
          const b = this.builder
          if (b && b.turn.status === 'running') {
            b.closeThinking(this.now())
            const status: TurnStatus =
              event.phase === 'cancelled' || this.pendingError?.kind === 'aborted' ? 'aborted' : event.phase === 'failed' || this.pendingError ? 'failed' : 'done'
            b.settle(status, this.now(), status === 'done' ? undefined : this.pendingError ?? { kind: status === 'aborted' ? 'aborted' : 'error', text: event.phase })
            out.push({ op: 'turn.settle', turnId: b.turn.id, status, durationMs: b.turn.durationMs, files: b.turn.files, ...(b.turn.error ? { error: b.turn.error } : {}) })
          }
          this.pendingError = undefined
          out.push(this.setState({ running: false }))
        }
        break
      }
      case 'queue': {
        out.push(this.setState({ queue: { steering: event.steering, followUp: event.followUp } }))
        break
      }
      case 'extension_widget': {
        if (event.protocol !== 'todo-list-v1') break
        const items = event.phase === 'set' ? event.state?.payload?.items : undefined
        out.push(
          this.setState({
            todo: items?.length
              ? {
                  title: event.state?.title || 'Todo',
                  items: items.slice(0, 200).map((i) => ({ id: String(i.id), text: String(i.text), status: i.status, ...(i.priority ? { priority: i.priority } : {}) })),
                }
              : null,
          }),
        )
        break
      }
      default:
        break
    }
    return out
  }
}
