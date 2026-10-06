import type { AppEvent } from '@shared/app-events'
import type { CapabilityInfo } from '@shared/capabilities'
import type { CacheWarming, CommandInfo, ContextStats, FileEntry, UiResponse } from '@shared/remote'
import type { ToolCardDef } from '../../../extension-compat/adapter-schema'
import type { HostSessionRow, HostTimelineItem, RemoteHostPort, RemoteTapSink, SendMode } from '../host-port'

/**
 * In-memory desktop for gateway tests and `scripts/remote-dev-host.mjs`. Sessions keep
 * worker-style timeline rows; `send()` plays a scripted agent run through the tap sink with
 * the same AppEvent sequence the real worker emits (see src/worker/worker-session-events.ts).
 */

type FakeSession = { row: HostSessionRow; items: HostTimelineItem[]; running: boolean; model: string; thinking: string; queue?: { steering: string[]; followUp: string[] }; aborted?: boolean }

export type FakeCalls = {
  sent: Array<{ sessionFile: string; text: string; mode: SendMode; capabilities: string[] }>
  aborted: string[]
  created: string[]
  responded: UiResponse[]
  cancelled: string[]
  dismissedDesktop: string[]
  settingsNotified: string[]
  sessionsNotified: string[]
  /** Must stay empty: the gateway may never touch desktop focus. */
  forbidden: string[]
}

export type FakeHostOptions = {
  projects?: string[]
  /** Delay between scripted agent events (ms). 0 = synchronous (tests). */
  stepMs?: number
}

export class FakeHost implements RemoteHostPort {
  readonly calls: FakeCalls = { sent: [], aborted: [], created: [], responded: [], cancelled: [], dismissedDesktop: [], settingsNotified: [], sessionsNotified: [], forbidden: [] }
  readonly sessions = new Map<string, FakeSession>()
  readonly store = new Map<string, unknown>()
  capabilities: Record<string, string[]> = {}
  cacheWarming: CacheWarming = 'streaming'
  sink: RemoteTapSink | null = null
  /** Created sessions whose file pi has not written yet (it does so on the first reply). */
  readonly unwritten = new Set<string>()
  private seq = 0
  private entry = 100
  private readonly projects: string[]
  private readonly stepMs: number
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(opts: FakeHostOptions = {}) {
    this.projects = opts.projects ?? ['/work/pi-app', '/work/blog']
    this.stepMs = opts.stepMs ?? 0
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  // ── fixtures ──

  addSession(projectId: string, title: string, turns: Array<{ user: string; answer: string; tools?: Array<{ name: string; args: unknown; output: string }> }> = []): string {
    const file = `${projectId}/.pi/sessions/${title.replace(/\W+/g, '-') || 's'}-${++this.seq}.jsonl`
    const items: HostTimelineItem[] = []
    let t = 1_791_200_000_000 + this.seq * 1_000_000
    for (const turn of turns) {
      items.push({ id: `h${++this.entry}`, type: 'user-message', text: turn.user, sessionEntryId: `e${this.entry}`, timestamp: (t += 1000) })
      for (const tool of turn.tools ?? []) {
        items.push({ id: `h${++this.entry}`, type: 'assistant-message', text: '', sessionEntryId: `e${this.entry}`, timestamp: (t += 1000) })
        items.push({ id: `h${++this.entry}`, type: 'tool-call', toolCallId: `call${this.entry}`, toolName: tool.name, toolArgs: tool.args, toolOutput: tool.output, timestamp: (t += 1000) })
      }
      items.push({ id: `h${++this.entry}`, type: 'assistant-message', text: turn.answer, sessionEntryId: `e${this.entry}`, timestamp: (t += 1000) })
    }
    this.sessions.set(file, {
      row: { sessionFile: file, projectId, title, createdAt: t - 10_000, updatedAt: t, firstMessage: turns[0]?.user },
      items,
      running: false,
      model: 'anthropic/sonnet-5',
      thinking: 'high',
    })
    return file
  }

  private emit(event: AppEvent): void {
    this.sink?.appEvent(event)
  }

  private base(file: string) {
    return { seq: ++this.seq, workspaceId: this.sessions.get(file)?.row.projectId ?? '', sessionFile: file, timestamp: Date.now() }
  }

  /** Play a scripted run; optionally pause on an extension question first. */
  playRun(file: string, text: string, opts: { ask?: boolean } = {}): Promise<void> {
    const s = this.sessions.get(file)
    if (!s) return Promise.resolve()
    const entryUser = `e${++this.entry}`
    const toolId = `run-${entryUser}`
    const askId = `ask-${entryUser}`
    const todo = (statuses: string[]) => () =>
      this.emit({
        ...this.base(file),
        type: 'extension_widget',
        phase: 'set',
        widgetKey: 'todo',
        adapterId: 'pi-todo',
        protocol: 'todo-list-v1',
        state: {
          adapterId: 'pi-todo',
          widgetKey: 'todo',
          protocol: 'todo-list-v1',
          title: '待办',
          payload: { items: ['读代码定位问题', '修复刷新逻辑', '补测试', '更新 CHANGELOG'].map((t, i) => ({ id: String(i + 1), text: t, status: statuses[i], ...(i === 1 ? { priority: 'high' } : {}) })) },
          updatedAt: Date.now(),
        },
      } as unknown as AppEvent)
    const plan = text.includes('计划')
    const steps: Array<() => void> = [
      ...(plan ? [todo(['in_progress', 'pending', 'pending', 'pending'])] : []),
      () => {
        s.running = true
        this.emit({ ...this.base(file), type: 'run', phase: 'running' })
      },
      () => this.emit({ ...this.base(file), type: 'message', role: 'user', phase: 'start', text }),
      () => {
        s.items.push({ id: `h${entryUser}`, type: 'user-message', text, sessionEntryId: entryUser, timestamp: Date.now() })
        this.emit({ ...this.base(file), type: 'message', role: 'user', phase: 'end', sessionEntryId: entryUser })
      },
      () => this.emit({ ...this.base(file), type: 'message', role: 'assistant', phase: 'start' }),
      () => this.emit({ ...this.base(file), type: 'message', role: 'assistant', phase: 'delta', text: 'Plan: run the tests. ', contentKind: 'thinking' }),
      () => this.emit({ ...this.base(file), type: 'tool', toolCallId: toolId, toolName: 'bash', phase: 'start', input: { command: 'npm test' } }),
      () =>
        this.emit({
          ...this.base(file),
          type: 'tool',
          toolCallId: toolId,
          toolName: 'bash',
          phase: 'end',
          output: { content: [{ type: 'text', text: 'Tests 3 passed (3)' }] },
          isError: false,
        }),
      ...(opts.ask
        ? [
            () =>
              this.sink?.uiRequest({
                id: askId,
                method: 'custom',
                kind: 'ask_user_question',
                questions: [{ question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] }],
                sessionFile: file,
              } as never),
          ]
        : []),
      ...(plan ? [todo(['completed', 'in_progress', 'pending', 'pending'])] : []),
      () => this.emit({ ...this.base(file), type: 'message', role: 'assistant', phase: 'delta', text: '全部通过，', contentKind: 'text' }),
      () => this.emit({ ...this.base(file), type: 'message', role: 'assistant', phase: 'delta', text: '没有回归。', contentKind: 'text' }),
      () => {
        s.items.push({ id: `h${++this.entry}`, type: 'tool-call', toolCallId: toolId, toolName: 'bash', toolArgs: { command: 'npm test' }, toolOutput: 'Tests 3 passed (3)', timestamp: Date.now() })
        s.items.push({ id: `h${++this.entry}`, type: 'assistant-message', text: '全部通过，没有回归。', sessionEntryId: `e${this.entry}`, timestamp: Date.now() })
        s.row = { ...s.row, updatedAt: Date.now() }
        s.running = false
        this.unwritten.delete(file)
        this.emit({ ...this.base(file), type: 'run', phase: 'idle', settled: true })
      },
    ]
    if (!this.stepMs) {
      for (const step of steps) step()
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let i = 0
      const next = () => {
        if (s.aborted) {
          s.aborted = false
          s.running = false
          this.emit({ ...this.base(file), type: 'run', phase: 'idle', settled: true })
          return resolve()
        }
        steps[i++]()
        if (i >= steps.length) return resolve()
        const t = setTimeout(() => {
          this.timers.delete(t)
          next()
        }, this.stepMs)
        this.timers.add(t)
      }
      next()
    })
  }

  // ── RemoteHostPort ──

  hostName(): string {
    return 'fake-desktop'
  }
  appVersion(): string {
    return '0.0.0-test'
  }
  trustedProjects(): string[] {
    return this.projects
  }
  projectInfo(path: string) {
    return path.includes('/sandbox-workspaces/') ? { temporary: true, label: '临时：问个问题' } : {}
  }
  async listSessions(projectId: string): Promise<HostSessionRow[]> {
    return [...this.sessions.values()].filter((s) => s.row.projectId === projectId && !this.unwritten.has(s.row.sessionFile)).map((s) => ({ ...s.row }))
  }
  async sessionProject(sessionFile: string): Promise<string | null> {
    return this.sessions.get(sessionFile)?.row.projectId ?? null
  }
  async readHistory(_projectId: string, sessionFile: string) {
    if (this.unwritten.has(sessionFile)) throw new Error('invalid_session')
    const s = this.sessions.get(sessionFile)
    return { items: s ? structuredClone(s.items) : [], model: s?.model, thinking: s?.thinking }
  }
  async liveState(sessionFile: string) {
    const s = this.sessions.get(sessionFile)
    return { running: !!s?.running, model: s?.model, thinking: s?.thinking, availableThinking: ['off', 'low', 'medium', 'high'] }
  }
  async send(sessionFile: string, text: string, mode: SendMode, capabilities: string[]): Promise<void> {
    this.calls.sent.push({ sessionFile, text, mode, capabilities })
    const s = this.sessions.get(sessionFile)
    if (mode !== 'prompt' && s?.running) {
      const q = (s.queue ??= { steering: [], followUp: [] })
      ;(mode === 'steer' ? q.steering : q.followUp).push(text)
      this.emitQueue(sessionFile)
      return
    }
    if (mode === 'prompt') void this.playRun(sessionFile, text, { ask: text.includes('问我') })
  }
  private emitQueue(file: string): void {
    const q = this.sessions.get(file)?.queue ?? { steering: [], followUp: [] }
    this.emit({ ...this.base(file), type: 'queue', steering: [...q.steering], followUp: [...q.followUp] } as AppEvent)
  }
  async abort(sessionFile: string): Promise<void> {
    this.calls.aborted.push(sessionFile)
    const s = this.sessions.get(sessionFile)
    if (s?.running) s.aborted = true
  }
  async rewind(sessionFile: string, anchor: string): Promise<{ editorText?: string }> {
    const s = this.sessions.get(sessionFile)
    const i = s?.items.findIndex((it) => it.type === 'user-message' && it.sessionEntryId === anchor) ?? -1
    if (!s || i < 0) throw new Error('entry not found')
    const editorText = s.items[i].text
    s.items = s.items.slice(0, i)
    return { editorText }
  }
  async clearQueue(sessionFile: string): Promise<string[]> {
    const s = this.sessions.get(sessionFile)
    if (!s?.queue) return []
    const out = [...s.queue.steering, ...s.queue.followUp]
    s.queue = { steering: [], followUp: [] }
    this.emitQueue(sessionFile)
    return out
  }
  readonly attachments = new Map<string, Uint8Array>()
  async saveAttachment(bytes: Uint8Array, name: string): Promise<string> {
    const path = `/fake/clipboard-images/pi-clipboard-${this.attachments.size + 1}-${name}`
    this.attachments.set(path, bytes)
    return path
  }
  async readAttachment(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const bytes = this.attachments.get(path)
    return bytes ? { bytes, mime: 'image/jpeg' } : null
  }
  async createSession(projectId: string): Promise<string> {
    const file = this.addSession(projectId, '新会话')
    this.unwritten.add(file)
    this.calls.created.push(file)
    return file
  }
  async listModels(sessionFile: string) {
    const s = this.sessions.get(sessionFile)
    return { models: [{ id: 'anthropic/sonnet-5', name: 'Sonnet 5' }, { id: 'openai/gpt-6', name: 'GPT-6' }], current: s?.model, thinking: s?.thinking, availableThinking: ['off', 'low', 'medium', 'high'] }
  }
  async setModel(sessionFile: string, modelId: string): Promise<string> {
    const s = this.sessions.get(sessionFile)
    if (s) s.model = modelId
    return modelId
  }
  async setThinking(sessionFile: string, level: string): Promise<void> {
    const s = this.sessions.get(sessionFile)
    if (s) s.thinking = level
  }
  respondUi(response: UiResponse): void {
    this.calls.responded.push(response)
  }
  cancelUi(id: string): void {
    this.calls.cancelled.push(id)
  }
  dismissDesktopUi(id: string): void {
    this.calls.dismissedDesktop.push(id)
  }
  commands: CommandInfo[] = [
    { name: '/review', description: 'Review the current diff', category: 'prompt' },
    { name: '/skill:pdf', description: 'Read and fill PDF forms', category: 'skill' },
    { name: '/skill:frontend-design', description: 'Distinctive production-grade UI', category: 'skill' },
    { name: '/todos', description: 'pi-todo', category: 'extension' },
  ]
  async listCommands(): Promise<CommandInfo[]> {
    return this.commands
  }
  /** Project files by relative path (folders end with '/'). */
  files = ['README.md', 'package.json', 'src/', 'src/auth.ts', 'src/index.ts', 'src/main/', 'src/main/app.ts', 'docs/', 'docs/设计 说明.md', '.env']
  async contextStats(sessionFile: string): Promise<ContextStats | null> {
    const s = this.sessions.get(sessionFile)
    if (!s) return null
    const chars = (type: string) => s.items.filter((i) => i.type === type).reduce((n, i) => n + (i.text?.length ?? 0) + JSON.stringify(i.toolArgs ?? '').length + (i.toolOutput?.length ?? 0), 0)
    const breakdown = [
      { role: 'system', tokens: 4200 },
      { role: 'user', tokens: Math.round(chars('user-message') / 4) },
      { role: 'assistant', tokens: Math.round(chars('assistant-message') / 4) + 900 },
      { role: 'tool', tokens: Math.round(chars('tool-call') / 4) + 18000 },
    ]
    return { tokens: breakdown.reduce((n, b) => n + b.tokens, 0), window: 200_000, messages: s.items.length, breakdown }
  }
  async listDir(_projectId: string, path: string, dotfiles: boolean): Promise<{ entries: FileEntry[]; truncated: boolean } | null> {
    const dir = path === '.' || path === '' ? '' : `${path.replace(/\/+$/, '')}/`
    if (dir.split('/').includes('..')) return null
    if (dir && !this.files.includes(dir)) return null
    const entries = this.files
      .filter((f) => f !== dir && f.startsWith(dir) && !f.slice(dir.length).replace(/\/$/, '').includes('/'))
      .map((f) => ({ name: f.slice(dir.length).replace(/\/$/, ''), path: f.replace(/\/$/, ''), dir: f.endsWith('/'), ...(f.endsWith('/') ? {} : { size: 1200 }), mtime: Date.now() - 3_600_000 }))
      .filter((e) => dotfiles || !e.name.startsWith('.'))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    return { entries, truncated: false }
  }
  async searchFiles(_projectId: string, query: string): Promise<FileEntry[]> {
    const q = query.toLowerCase()
    return this.files
      .filter((f) => f.toLowerCase().includes(q))
      .map((f) => ({ name: f.replace(/\/$/, '').split('/').pop()!, path: f.replace(/\/$/, ''), dir: f.endsWith('/') }))
  }
  capabilityCatalog(): CapabilityInfo[] {
    return [
      { id: 'pi-ui', available: true, promptTokens: 2410, tools: 0 },
      { id: 'browser', available: false, reason: 'browser-panel-off', promptTokens: 3100, tools: 24 },
    ]
  }
  sessionCapabilities(sessionFile: string): string[] {
    return this.capabilities[sessionFile] ?? []
  }
  setSessionCapabilities(sessionFile: string, ids: string[]): void {
    this.capabilities[sessionFile] = ids
  }
  async getCacheWarming(): Promise<CacheWarming> {
    return this.cacheWarming
  }
  async setCacheWarming(mode: CacheWarming): Promise<CacheWarming> {
    this.cacheWarming = mode
    return mode
  }
  notifySettingsChanged(key: 'cacheWarming' | 'capabilities' | 'rewound'): void {
    this.calls.settingsNotified.push(key)
  }
  notifySessionsChanged(projectId: string): void {
    this.calls.sessionsNotified.push(projectId)
  }
  toolCardFor(toolName: string): ToolCardDef | undefined {
    return toolName === 'web_search' ? { template: 'list', icon: 'search', fields: { items: '$.details.results', title: '$.args.query' } } : undefined
  }
  storage = {
    get: (key: string) => structuredClone(this.store.get(key)),
    set: (key: string, value: unknown) => void this.store.set(key, structuredClone(value)),
  }
  secrets = {
    available: () => true,
    seal: (plain: string) => `sealed:${plain}`,
    open: (sealed: string) => (sealed.startsWith('sealed:') ? sealed.slice(7) : null),
  }
  assetPath(): string | null {
    return null
  }
  log(): void {}
}
