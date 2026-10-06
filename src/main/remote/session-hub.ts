import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { AppEvent } from '@shared/app-events'
import { normalizeSessionFileKey } from '@shared/session-file-key'
import type { Cursor, DiffFile, DiffLine, OpenResult, RemoteEvent, SessionSummary, Turn, TurnPatch, UiRequest } from '@shared/remote'
import { base64UrlEncode } from '@shared/remote'
import { RpcFail } from './errors'
import type { HostSessionRow, RemoteHostPort } from './host-port'
import { LiveProjector, projectHistory, type PatchBody } from './projector'
import { capLines, parsePiDiff, parseUnifiedDiff, type ParsedDiffFile } from './diff-model'
import { outputText } from './render-node'
import type { UiRouter } from './ui-router'

/** A connected, authenticated remote client as the hub sees it. */
export interface HubClient {
  readonly id: string
  sendEvent(event: RemoteEvent, payload: unknown): void
  queuePatches(sessionKey: string, patches: TurnPatch[]): void
}

export const RING_MAX = 2000
export const PAGE_SIZE = 20
const LIST_PUSH_MS = 300
const ENRICH_TOP = 10
const OUTPUT_KEEP = 50
const OUTPUT_MAX = 256 * 1024

type Entry = {
  key: string
  sessionFile: string
  projector: LiveProjector
  seq: number
  ring: TurnPatch[]
  subscribers: Set<HubClient>
  seeded: boolean
  lastAnswer?: string
  lastFailure?: string
  updatedAt: number
  outputs: Map<string, string>
}

type HistoryCache = { stamp: string; turns: Turn[] }

const firstLine = (text: string, max = 120): string => {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[#>*\-\s`]+/, '').trim()
    if (line && !line.startsWith('```')) return line.length > max ? `${line.slice(0, max - 1)}…` : line
  }
  return ''
}

export function uiPreview(req: UiRequest): string {
  switch (req.method) {
    case 'custom':
      return req.kind === 'ask_user_question' ? (req.questions[0]?.question ?? '') : req.question
    case 'notify':
      return req.message
    default:
      return req.title
  }
}

export class SessionHub {
  readonly epoch = `e_${base64UrlEncode(randomBytes(6))}`
  private readonly entries = new Map<string, Entry>()
  private readonly history = new Map<string, HistoryCache>()
  private readonly rows = new Map<string, HostSessionRow>()
  private readonly enriched = new Map<string, { stamp: number; preview?: string; turn?: Turn }>()
  private readonly listWatchers = new Map<HubClient, { projectId?: string }>()
  private readonly dirty = new Set<string>()
  private listTimer: ReturnType<typeof setTimeout> | null = null
  private readonly refreshing = new Set<string>()
  /** Sessions created from a phone that the desktop sidebar has not been told about yet (key → project). */
  private readonly unlisted = new Map<string, string>()
  private readonly probing = new Set<string>()

  constructor(
    private readonly port: RemoteHostPort,
    private readonly ui: UiRouter,
    private readonly allowedProjects: () => string[],
    private readonly now: () => number = Date.now,
  ) {}

  dispose(): void {
    if (this.listTimer) clearTimeout(this.listTimer)
    this.listTimer = null
    this.listWatchers.clear()
    for (const e of this.entries.values()) e.subscribers.clear()
  }

  // ── Projects / authorization ──

  isAllowedProject(projectId: string): boolean {
    const want = normalizeSessionFileKey(projectId).replace(/\/+$/, '')
    return this.allowedProjects().some((p) => normalizeSessionFileKey(p).replace(/\/+$/, '') === want)
  }

  private allowedProjectFor(projectId: string): string | undefined {
    const want = normalizeSessionFileKey(projectId).replace(/\/+$/, '')
    return this.allowedProjects().find((p) => normalizeSessionFileKey(p).replace(/\/+$/, '') === want)
  }

  /** Resolve the session's workspace and require it to be whitelisted. */
  async authorize(sessionKey: string): Promise<{ entry: Entry; projectId: string }> {
    const row = this.rows.get(normalizeSessionFileKey(sessionKey))
    const sessionFile = row?.sessionFile ?? sessionKey
    const cwd = row?.projectId ?? (await this.port.sessionProject(sessionFile))
    const projectId = cwd ? this.allowedProjectFor(cwd) : undefined
    if (!projectId) throw new RpcFail('forbidden', 'session is not in an allowed project')
    return { entry: this.entryFor(sessionFile), projectId }
  }

  private entryFor(sessionFile: string): Entry {
    const key = normalizeSessionFileKey(sessionFile)
    let e = this.entries.get(key)
    if (!e) {
      e = {
        key,
        sessionFile,
        projector: new LiveProjector((tool) => this.toolCard(tool, key), this.now),
        seq: 0,
        ring: [],
        subscribers: new Set(),
        seeded: false,
        updatedAt: 0,
        outputs: new Map(),
      }
      this.entries.set(key, e)
    }
    return e
  }

  private toolCard(toolName: string, key: string) {
    const project = this.rows.get(key)?.projectId
    return project ? this.port.toolCardFor(toolName, project) : undefined
  }

  // ── Live events ──

  onAppEvent(event: AppEvent): void {
    const file = 'sessionFile' in event ? event.sessionFile : undefined
    if (!file) return
    const entry = this.entryFor(file)
    if (event.type === 'tool' && event.phase === 'end') this.keepOutput(entry, event.toolCallId, outputText(event.output))
    const bodies = entry.projector.apply(event)
    if (!bodies.length) return
    entry.updatedAt = this.now()
    for (const b of bodies) {
      if (b.op === 'turn.upsert' && b.turn.status === 'running') entry.lastFailure = undefined
      if (b.op === 'turn.settle') {
        const live = entry.projector.liveTurn
        if (b.status === 'done' && live) entry.lastAnswer = firstLine(live.answer) || entry.lastAnswer
        entry.lastFailure = b.status === 'failed' ? b.error?.text || 'failed' : undefined
      }
    }
    this.publish(entry, bodies)
    if (this.unlisted.has(entry.key)) void this.announceToDesktop(entry, bodies.some((b) => b.op === 'turn.settle'))
    if (!this.rows.has(entry.key)) void this.refreshRowsFor(entry.sessionFile)
    this.markDirty(entry.key)
  }

  /**
   * pi writes a new session file only once the first reply lands, so the desktop list cannot show
   * a phone-created session until then. Tell the renderer as soon as the file exists (or the run settles).
   */
  private async announceToDesktop(entry: Entry, settled: boolean): Promise<void> {
    if (!settled) {
      if (this.probing.has(entry.key)) return
      this.probing.add(entry.key)
      const exists = await stat(entry.sessionFile).then(() => true, () => false)
      this.probing.delete(entry.key)
      if (!exists) return
    }
    const projectId = this.unlisted.get(entry.key)
    if (!projectId) return
    this.unlisted.delete(entry.key)
    this.port.notifySessionsChanged(projectId)
  }

  private keepOutput(entry: Entry, toolCallId: string, text: string): void {
    if (!toolCallId || !text) return
    entry.outputs.delete(toolCallId)
    entry.outputs.set(toolCallId, text.length > OUTPUT_MAX ? text.slice(text.length - OUTPUT_MAX) : text)
    while (entry.outputs.size > OUTPUT_KEEP) entry.outputs.delete(entry.outputs.keys().next().value as string)
  }

  private publish(entry: Entry, bodies: PatchBody[]): void {
    const patches = bodies.map((b) => ({ ...b, seq: ++entry.seq }) as TurnPatch)
    entry.ring.push(...patches)
    if (entry.ring.length > RING_MAX) entry.ring.splice(0, entry.ring.length - RING_MAX)
    for (const c of entry.subscribers) c.queuePatches(entry.key, patches)
  }

  /** Extension UI state changed for a session: inbox status may flip to/from "needs input". */
  onUiChanged(sessionKey: string): void {
    this.markDirty(normalizeSessionFileKey(sessionKey))
  }

  subscribersOf(sessionKey: string): HubClient[] {
    return [...(this.entries.get(normalizeSessionFileKey(sessionKey))?.subscribers ?? [])]
  }

  // ── Session list / inbox ──

  private async refreshRowsFor(sessionFile: string): Promise<void> {
    const project = await this.port.sessionProject(sessionFile).catch(() => null)
    if (!project) return
    const allowed = this.allowedProjectFor(project)
    if (!allowed || this.refreshing.has(allowed)) return
    this.refreshing.add(allowed)
    try {
      await this.loadRows(allowed)
      this.markDirty(normalizeSessionFileKey(sessionFile))
    } finally {
      this.refreshing.delete(allowed)
    }
  }

  private async loadRows(projectId: string): Promise<HostSessionRow[]> {
    const rows = await this.port.listSessions(projectId)
    for (const r of rows) this.rows.set(normalizeSessionFileKey(r.sessionFile), { ...r, projectId })
    return rows.map((r) => ({ ...r, projectId }))
  }

  private summaryFor(row: HostSessionRow, pending: Map<string, UiRequest>): SessionSummary {
    const key = normalizeSessionFileKey(row.sessionFile)
    const e = this.entries.get(key)
    const state = e?.projector.sessionState
    const live = e?.projector.liveTurn
    const ask = pending.get(key)
    const extra = this.enriched.get(key)
    const running = !!state?.running
    const status: SessionSummary['status'] = ask ? 'needsInput' : running ? 'running' : e?.lastFailure ? 'failed' : 'idle'
    const out: SessionSummary = {
      sessionKey: row.sessionFile,
      projectId: row.projectId,
      title: row.title,
      status,
      updatedAt: Math.max(row.updatedAt, e?.updatedAt ?? 0),
    }
    const preview = ask ? uiPreview(ask) : status === 'failed' ? e?.lastFailure : e?.lastAnswer ?? extra?.preview ?? (row.firstMessage ? firstLine(row.firstMessage) : undefined)
    if (preview) out.preview = preview
    const turn = running && live ? live : (live ?? extra?.turn)
    if (turn) {
      out.counts = turn.activity.counts
      if (turn.files.length) out.filesChanged = turn.files.length
      if (running && live) {
        if (live.startedAt) out.startedAt = live.startedAt
        const step = live.steps.find((s) => s.id === live.activity.live) ?? live.steps[live.steps.length - 1]
        if (step?.kind === 'tool') {
          out.live = step.node.title
          out.liveCategory = step.category
        } else if (step?.kind === 'thinking') out.live = ''
      }
    }
    return out
  }

  async listSummaries(projectId?: string): Promise<SessionSummary[]> {
    const projects = projectId ? (this.allowedProjectFor(projectId) ? [this.allowedProjectFor(projectId)!] : []) : this.allowedProjects()
    if (projectId && !projects.length) throw new RpcFail('forbidden', 'project is not allowed')
    const rows = (await Promise.all(projects.map((p) => this.loadRows(p).catch(() => [] as HostSessionRow[])))).flat()
    const pending = this.ui.pendingBySession()
    return rows.map((r) => this.summaryFor(r, pending)).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async watchList(client: HubClient, projectId?: string): Promise<SessionSummary[]> {
    const sessions = await this.listSummaries(projectId)
    this.listWatchers.set(client, { ...(projectId ? { projectId } : {}) })
    void this.enrich(sessions)
    return sessions
  }

  unwatchList(client: HubClient): void {
    this.listWatchers.delete(client)
  }

  /** Fill previews of the most recent idle sessions from their history (cached by file stamp). */
  private async enrich(sessions: SessionSummary[]): Promise<void> {
    const candidates = sessions.filter((s) => s.status === 'idle').slice(0, ENRICH_TOP)
    for (const s of candidates) {
      const key = normalizeSessionFileKey(s.sessionKey)
      if (this.entries.get(key)?.lastAnswer) continue
      if ((this.enriched.get(key)?.stamp ?? -1) >= s.updatedAt) continue
      try {
        const turns = await this.loadHistoryTurns(this.entryFor(s.sessionKey), s.projectId)
        const last = turns[turns.length - 1]
        this.enriched.set(key, { stamp: s.updatedAt, ...(last ? { turn: last, preview: firstLine(last.answer) || undefined } : {}) })
        this.markDirty(key)
      } catch {
        /* preview stays the first message */
      }
    }
  }

  private markDirty(key: string): void {
    this.dirty.add(key)
    if (this.listTimer || !this.listWatchers.size) return
    this.listTimer = setTimeout(() => {
      this.listTimer = null
      this.flushList()
    }, LIST_PUSH_MS)
  }

  private flushList(): void {
    const keys = [...this.dirty]
    this.dirty.clear()
    if (!keys.length) return
    const pending = this.ui.pendingBySession()
    const summaries = keys
      .map((k) => this.rows.get(k))
      .filter((r): r is HostSessionRow => !!r && this.isAllowedProject(r.projectId))
      .map((r) => this.summaryFor(r, pending))
    if (!summaries.length) return
    for (const [client, filter] of this.listWatchers) {
      const mine = filter.projectId ? summaries.filter((s) => normalizeSessionFileKey(s.projectId) === normalizeSessionFileKey(filter.projectId!)) : summaries
      if (mine.length) client.sendEvent('sessions.update', { sessions: mine })
    }
  }

  /** A session was created remotely: make sure watchers see it right away. */
  announceSession(sessionFile: string, projectId: string): void {
    const key = normalizeSessionFileKey(sessionFile)
    // Provisional row right away; the file (and the real row) appears with the first reply.
    if (!this.rows.has(key)) this.rows.set(key, { sessionFile, projectId, title: '新会话', createdAt: this.now(), updatedAt: this.now() })
    this.unlisted.set(key, projectId)
    this.markDirty(key)
  }

  // ── Timeline ──

  private async historyStamp(sessionFile: string): Promise<string> {
    try {
      const s = await stat(sessionFile)
      return `${s.mtimeMs}:${s.size}`
    } catch {
      return `nostat:${this.now()}`
    }
  }

  private async loadHistoryTurns(entry: Entry, projectId: string): Promise<Turn[]> {
    const stamp = await this.historyStamp(entry.sessionFile)
    const cached = this.history.get(entry.key)
    if (cached && cached.stamp === stamp) return cached.turns
    let h: Awaited<ReturnType<RemoteHostPort['readHistory']>>
    try {
      h = await this.port.readHistory(projectId, entry.sessionFile)
    } catch (err) {
      // A brand-new session has no file until its first reply: that is an empty timeline, not an error.
      if (stamp.startsWith('nostat:')) return []
      throw err
    }
    const turns = projectHistory(h.items, (tool) => this.port.toolCardFor(tool, projectId), { model: h.model, thinking: h.thinking })
    this.history.set(entry.key, { stamp, turns })
    if (this.history.size > 40) this.history.delete(this.history.keys().next().value as string)
    return turns
  }

  /** History with the live turn laid over it (live wins for the same anchor). */
  private mergedTurns(entry: Entry, history: Turn[]): Turn[] {
    const live = entry.projector.liveTurn
    if (!live) return history
    const i = history.findIndex((t) => t.anchor === live.anchor)
    if (i >= 0) {
      const out = history.slice()
      out[i] = live
      return out
    }
    return [...history, live]
  }

  async open(client: HubClient, sessionKey: string, cursor?: Cursor): Promise<OpenResult> {
    const { entry, projectId } = await this.authorize(sessionKey)
    if (!entry.seeded) {
      entry.seeded = true
      const st = await this.port.liveState(entry.sessionFile).catch(() => ({ running: false }))
      entry.projector.seedState(st)
    }
    const title = this.rows.get(entry.key)?.title ?? ''
    const base = { sessionKey: entry.sessionFile, title, epoch: this.epoch }

    if (cursor && cursor.epoch === this.epoch) {
      const oldest = entry.ring[0]?.seq
      const canReplay = cursor.seq === entry.seq || (oldest !== undefined && oldest <= cursor.seq + 1 && cursor.seq <= entry.seq)
      if (canReplay) {
        const patches = entry.ring.filter((p) => p.seq > cursor.seq)
        this.subscribe(client, entry)
        return { ...base, seq: entry.seq, kind: 'replay', patches, state: entry.projector.sessionState, pendingUi: this.ui.pendingFor(entry.key) }
      }
    }

    const history = await this.loadHistoryTurns(entry, projectId)
    // No await between merging the live turn and subscribing: every patch after `seq` reaches the client.
    const turns = this.mergedTurns(entry, history)
    this.subscribe(client, entry)
    const resync = cursor ? (cursor.epoch !== this.epoch ? 'epoch_changed' : entry.ring.length >= RING_MAX ? 'evicted' : 'gap') : undefined
    return {
      ...base,
      seq: entry.seq,
      kind: 'snapshot',
      ...(resync ? { resync } : {}),
      turns: turns.slice(-PAGE_SIZE),
      hasOlder: turns.length > PAGE_SIZE,
      state: entry.projector.sessionState,
      pendingUi: this.ui.pendingFor(entry.key),
    }
  }

  private subscribe(client: HubClient, entry: Entry): void {
    for (const e of this.entries.values()) if (e !== entry) e.subscribers.delete(client)
    entry.subscribers.add(client)
  }

  close(client: HubClient, sessionKey: string): void {
    this.entries.get(normalizeSessionFileKey(sessionKey))?.subscribers.delete(client)
  }

  detach(client: HubClient): void {
    this.listWatchers.delete(client)
    for (const e of this.entries.values()) e.subscribers.delete(client)
  }

  /** Rewind the session, then have every viewer re-open it (its turns changed under them). */
  async rewind(sessionKey: string, anchor: string): Promise<{ editorText?: string }> {
    const { entry, projectId } = await this.authorize(sessionKey)
    if (entry.projector.sessionState.running) throw new RpcFail('busy', 'stop the run before rewinding')
    if (anchor.startsWith('live:')) throw new RpcFail('conflict', 'message is not saved yet')
    const r = await this.port.rewind(entry.sessionFile, anchor, projectId)
    // The leaf lives outside the JSONL, so the file stamp would not invalidate the cache.
    this.history.delete(entry.key)
    entry.projector.clearLiveTurn()
    this.publish(entry, [{ op: 'timeline.reset' }])
    this.port.notifySettingsChanged('rewound', entry.sessionFile)
    return r
  }

  async page(sessionKey: string, before: string, limit: number): Promise<{ turns: Turn[]; hasOlder: boolean }> {
    const { entry, projectId } = await this.authorize(sessionKey)
    const turns = this.mergedTurns(entry, await this.loadHistoryTurns(entry, projectId))
    const idx = turns.findIndex((t) => t.anchor === before)
    if (idx < 0) throw new RpcFail('not_found', 'anchor not found')
    const start = Math.max(0, idx - limit)
    return { turns: turns.slice(start, idx), hasOlder: start > 0 }
  }

  async toolDetail(sessionKey: string, toolCallId: string): Promise<{ node: import('@shared/remote').RenderNode; output?: string }> {
    const { entry, projectId } = await this.authorize(sessionKey)
    const turns = this.mergedTurns(entry, await this.loadHistoryTurns(entry, projectId))
    for (let i = turns.length - 1; i >= 0; i--) {
      const step = turns[i].steps.find((s) => s.kind === 'tool' && s.toolCallId === toolCallId)
      if (step?.kind === 'tool') {
        const output = entry.outputs.get(toolCallId) ?? step.node.preview
        return { node: step.node, ...(output ? { output } : {}) }
      }
    }
    throw new RpcFail('not_found', 'tool call not found')
  }

  /** `review.diff`: the working tree (git) or one turn's edit / write calls, as display lines. */
  async reviewDiff(
    sessionKey: string,
    scope: 'git' | 'turn',
    turnId: string | undefined,
    path: string | undefined,
  ): Promise<{ isRepo: boolean; branch?: string; files: DiffFile[]; file?: { path: string; lines: DiffLine[]; truncated: boolean }; message?: string }> {
    const { entry, projectId } = await this.authorize(sessionKey)
    let files: ParsedDiffFile[]
    let head: { isRepo: boolean; branch?: string; message?: string } = { isRepo: true }
    if (scope === 'git') {
      const g = await this.port.gitDiff(projectId)
      head = { isRepo: g.isRepo, ...(g.branch ? { branch: g.branch } : {}), ...(g.message ? { message: g.message } : {}) }
      files = parseUnifiedDiff(g.raw)
    } else {
      const turns = this.mergedTurns(entry, await this.loadHistoryTurns(entry, projectId))
      const turn = turnId ? turns.find((t) => t.id === turnId) : turns[turns.length - 1]
      if (!turn) throw new RpcFail('not_found', 'turn not found')
      files = turnChanges(turn)
    }
    const list = files.map(({ lines: _l, ...f }) => f)
    if (path === undefined) return { ...head, files: list }
    const hit = files.find((f) => f.path === path)
    if (!hit) throw new RpcFail('not_found', 'file has no changes')
    return { ...head, files: list, file: { path, ...capLines(hit.lines) } }
  }
}

/** One turn's edit / write calls per file, in order (the timeline's `files` stats use the same calls). */
function turnChanges(turn: Turn): ParsedDiffFile[] {
  const byPath = new Map<string, ParsedDiffFile>()
  for (const step of turn.steps) {
    if (step.kind !== 'tool' || step.status === 'error') continue
    const node = step.node
    if (node.template !== 'edit' && node.template !== 'write') continue
    const path = typeof node.fields.path === 'string' ? node.fields.path : ''
    if (!path) continue
    const f = byPath.get(path) ?? { path, add: 0, del: 0, status: node.template === 'write' ? ('added' as const) : ('modified' as const), lines: [] }
    const lines =
      node.template === 'write'
        ? (node.preview ?? '').split('\n').map((s, i): DiffLine => ({ k: 'add', n: i + 1, s }))
        : parsePiDiff(node.preview ?? '')
    if (f.lines.length && lines.length) f.lines.push({ k: 'gap', s: '' })
    f.lines.push(...lines)
    f.add += typeof node.fields.add === 'number' ? node.fields.add : lines.filter((l) => l.k === 'add').length
    f.del += typeof node.fields.del === 'number' ? node.fields.del : lines.filter((l) => l.k === 'del').length
    if (node.detail) f.lines.push({ k: 'gap', s: '…' })
    byPath.set(path, f)
  }
  return [...byPath.values()]
}
