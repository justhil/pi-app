import type { TreeRow } from '../branches'
import type { AppEvent } from '@shared/app-events'
import type { CapabilityInfo } from '@shared/capabilities'
import type {
  CacheWarming,
  CommandInfo,
  ContextStats,
  FileEntry,
  FileReadResult,
  HostBrowseResult,
  PurgeSend,
  PurgeStateResult,
  UiResponse,
  UsageSummaryResult,
} from '@shared/remote'
import { normalizeSessionFileKey } from '@shared/session-file-key'
import type { ToolCardDef } from '../../../extension-compat/adapter-schema'
import type { HostSessionRow, HostTimelineItem, RemoteHostPort, RemoteTapSink, SendMode } from '../host-port'

/**
 * In-memory desktop for gateway tests and `scripts/remote-dev-host.mjs`. Sessions keep
 * worker-style timeline rows; `send()` plays a scripted agent run through the tap sink with
 * the same AppEvent sequence the real worker emits (see src/worker/worker-session-events.ts).
 */

type FakeSession = { row: HostSessionRow; items: HostTimelineItem[]; running: boolean; model: string; thinking: string; queue?: { steering: string[]; followUp: string[] }; aborted?: boolean; alts?: HostTimelineItem[][] }

export type FakeCalls = {
  sent: Array<{ sessionFile: string; text: string; mode: SendMode; capabilities: string[]; agentPurge?: PurgeSend }>
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
  purgedSessions: Record<string, { personaId: string; personaName: string; mode: 'replace' | 'append' | 'strict' }> = {}
  extraDirs: string[] = ['/work/extra-repo', '/work/notes']
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

  addSession(projectId: string, title: string, turns: Array<{ user: string; answer: string; tools?: Array<{ name: string; args: unknown; output: string; details?: unknown }> }> = []): string {
    const file = `${projectId}/.pi/sessions/${title.replace(/\W+/g, '-') || 's'}-${++this.seq}.jsonl`
    const items: HostTimelineItem[] = []
    let t = 1_791_200_000_000 + this.seq * 1_000_000
    for (const turn of turns) {
      items.push({ id: `h${++this.entry}`, type: 'user-message', text: turn.user, sessionEntryId: `e${this.entry}`, timestamp: (t += 1000) })
      for (const tool of turn.tools ?? []) {
        items.push({ id: `h${++this.entry}`, type: 'assistant-message', text: '', sessionEntryId: `e${this.entry}`, timestamp: (t += 1000) })
        items.push({ id: `h${++this.entry}`, type: 'tool-call', toolCallId: `call${this.entry}`, toolName: tool.name, toolArgs: tool.args, toolOutput: tool.output, ...(tool.details ? { toolDetails: tool.details } : {}), timestamp: (t += 1000) })
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
    const plan = text.includes('计划') || /\bplan\b/i.test(text)
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

  /** Shown on the phone; the dev host sets a friendlier name for README captures. */
  name = 'fake-desktop'
  hostName(): string {
    return this.name
  }
  appVersion(): string {
    return '0.0.0-test'
  }
  trustedProjects(): string[] {
    return this.projects
  }
  async admitProject(projectId: string): Promise<string | null> {
    if (!this.projects.includes(projectId) && !this.extraDirs.includes(projectId)) return null
    if (!this.projects.includes(projectId)) this.projects.push(projectId)
    return projectId
  }
  async browseHostDir(path = '/work'): Promise<HostBrowseResult> {
    const all = [...new Set([...this.projects, ...this.extraDirs])]
    const prefix = path.replace(/\/+$/, '') || '/'
    const entries = all
      .filter((d) => d.startsWith(prefix === '/' ? '/' : `${prefix}/`))
      .map((d) => {
        const rest = d.slice(prefix === '/' ? 1 : prefix.length + 1).split('/')[0]
        const full = `${prefix === '/' ? '' : prefix}/${rest}`
        return { name: rest, path: full, ...(full.includes('pi-app') || full.includes('repo') ? { git: true } : {}) }
      })
      .filter((v, i, arr) => v.name && arr.findIndex((x) => x.path === v.path) === i)
    return { path: prefix, parent: prefix === '/' ? null : '/', roots: ['/', '/work'], entries, truncated: false }
  }
  liveRunningSessions(): Set<string> {
    return new Set([...this.sessions.values()].filter((s) => s.running).map((s) => normalizeSessionFileKey(s.row.sessionFile)))
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
  async send(sessionFile: string, text: string, mode: SendMode, capabilities: string[], _projectId?: string, agentPurge?: PurgeSend): Promise<void> {
    this.calls.sent.push({ sessionFile, text, mode, capabilities, ...(agentPurge ? { agentPurge } : {}) })
    const s = this.sessions.get(sessionFile)
    if (mode === 'prompt' && agentPurge?.enabled && !this.purgedSessions[sessionFile] && !(s?.items.length)) {
      this.purgedSessions[sessionFile] = {
        personaId: agentPurge.personaId ?? 'konata',
        personaName: '泉此方 · 慵懒宅系工程师',
        mode: agentPurge.mode ?? 'replace',
      }
    }
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
    // The dropped turns stay in the tree as another branch, like pi's.
    s.alts = [...(s.alts ?? []), s.items]
    s.items = s.items.slice(0, i)
    return { editorText }
  }
  private static rowId = (it: HostTimelineItem) => it.sessionEntryId ?? it.id
  /** Tree rows from the current items and the other branches (shared prefixes share ids). */
  async sessionTree(sessionFile: string): Promise<{ rows: TreeRow[]; leafId: string | null }> {
    const s = this.sessions.get(sessionFile)
    if (!s) return { rows: [], leafId: null }
    const rows = new Map<string, TreeRow>()
    let t = 0
    for (const branch of [...(s.alts ?? []), s.items]) {
      let parent: string | null = null
      for (const it of branch) {
        const id = FakeHost.rowId(it)
        if (!rows.has(id)) {
          const role = it.type === 'user-message' ? 'user' : it.type === 'assistant-message' ? 'assistant' : 'toolResult'
          rows.set(id, { id, parentId: parent, entryType: 'message', role, preview: it.text, timestamp: new Date((it.timestamp ?? 0) + t++).toISOString() })
        }
        parent = id
      }
    }
    const last = s.items[s.items.length - 1]
    return { rows: [...rows.values()], leafId: last ? FakeHost.rowId(last) : null }
  }
  async switchBranch(sessionFile: string, leafId: string): Promise<void> {
    const s = this.sessions.get(sessionFile)
    const alts = s?.alts ?? []
    const idx = alts.findIndex((b) => b.some((it) => FakeHost.rowId(it) === leafId))
    if (!s || idx < 0) throw new Error('branch not found')
    const target = alts[idx]
    s.alts = [...alts.filter((_, i) => i !== idx), s.items]
    s.items = target.slice(0, target.findIndex((it) => FakeHost.rowId(it) === leafId) + 1)
  }
  async fork(sessionFile: string, anchor: string, projectId: string): Promise<{ sessionFile: string; editorText?: string }> {
    const s = this.sessions.get(sessionFile)
    const i = s?.items.findIndex((it) => it.type === 'user-message' && it.sessionEntryId === anchor) ?? -1
    if (!s || i < 0) throw new Error('entry not found')
    const file = this.addSession(projectId, `${s.row.title} fork`)
    this.sessions.get(file)!.items = s.items.slice(0, i)
    if (this.purgedSessions[sessionFile]) this.purgedSessions[file] = { ...this.purgedSessions[sessionFile] }
    return { sessionFile: file, editorText: s.items[i].text }
  }
  async clearQueue(sessionFile: string, index?: number): Promise<string[]> {
    const s = this.sessions.get(sessionFile)
    if (!s?.queue) return []
    const all = [
      ...s.queue.steering.map((text) => ({ text, mode: 'steer' as const })),
      ...s.queue.followUp.map((text) => ({ text, mode: 'followUp' as const })),
    ]
    if (index === undefined) {
      s.queue = { steering: [], followUp: [] }
      this.emitQueue(sessionFile)
      return all.map((x) => x.text)
    }
    if (index < 0 || index >= all.length) return []
    const kept = all.filter((_, i) => i !== index)
    s.queue = {
      steering: kept.filter((x) => x.mode === 'steer').map((x) => x.text),
      followUp: kept.filter((x) => x.mode === 'followUp').map((x) => x.text),
    }
    this.emitQueue(sessionFile)
    return [all[index].text]
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
  async renameSession(sessionFile: string, title: string): Promise<string> {
    const s = this.sessions.get(sessionFile)
    if (!s) throw new Error('session not found')
    s.row = { ...s.row, title }
    return title
  }
  async deleteSession(sessionFile: string): Promise<boolean> {
    const existed = this.sessions.delete(sessionFile)
    this.unwritten.delete(sessionFile)
    delete this.purgedSessions[sessionFile]
    return existed
  }
  async getPurgeState(sessionFile?: string): Promise<PurgeStateResult> {
    const personas = [{ id: 'konata', name: '泉此方 · 慵懒宅系工程师', description: '去八股、直接干脆' }]
    const base = { defaultPersonaId: 'konata', defaultMode: 'replace' as const, personas }
    if (!sessionFile) return base
    const locked = this.purgedSessions[sessionFile]
    if (locked) return { ...base, session: { locked: 'on', ...locked } }
    const s = this.sessions.get(sessionFile)
    return { ...base, session: { locked: s && (s.running || s.items.length > 0) ? 'off' : 'draft' } }
  }
  async setPurgeState(sessionFile: string, req: PurgeSend): Promise<PurgeStateResult> {
    if (!req.enabled) {
      delete this.purgedSessions[sessionFile]
    } else {
      this.purgedSessions[sessionFile] = {
        personaId: req.personaId ?? 'konata',
        personaName: '泉此方 · 慵懒宅系工程师',
        mode: req.mode ?? 'replace',
      }
    }
    this.notifySettingsChanged('purge')
    return this.getPurgeState(sessionFile)
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
  async sessionUsage(sessionFile: string): Promise<{ input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; calls: number } | null> {
    const s = this.sessions.get(sessionFile)
    if (!s) return null
    const calls = s.items.filter((i) => i.type === 'assistant-message' && i.text).length
    return { input: calls * 1200, output: calls * 300, cacheRead: calls * 18000, cacheWrite: 2000, cost: Math.round(calls * 0.0312 * 1e4) / 1e4, calls }
  }
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
  /** `git diff HEAD` the fake project shows on the phone's review screen. */
  gitRaw = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    'index 1111111..2222222 100644',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -10,6 +10,8 @@ export async function refresh(token: string) {',
    '   const now = Date.now()',
    '-  if (token.exp < now) return renew(token)',
    '+  // Refresh 30 s early so in-flight requests never carry an expired token.',
    '+  if (token.exp - 30_000 < now) return renew(token)',
    '+  inflight ??= renew(token).finally(() => (inflight = null))',
    '   return token',
    ' }',
    ' ',
    '@@ -40,3 +42,3 @@ export function logout() {',
    '-  store.clear()',
    '+  store.clear({ keepDevice: true })',
    '   location.assign("/login")',
    ' }',
    'diff --git a/docs/设计 说明.md b/docs/设计 说明.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/设计 说明.md',
    '@@ -0,0 +1,3 @@',
    '+# 刷新策略',
    '+',
    '+单飞刷新，提前 30 秒。',
    'diff --git a/assets/logo.png b/assets/logo.png',
    'index 3333333..4444444 100644',
    'Binary files a/assets/logo.png and b/assets/logo.png differ',
    '',
  ].join('\n')
  async gitDiff(): Promise<{ isRepo: boolean; branch: string; raw: string }> {
    return { isRepo: true, branch: 'main', raw: this.gitRaw }
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
  async readFile(_projectId: string, path: string): Promise<
    { ok: true; value: FileReadResult } | { ok: false; code: 'not_found' | 'forbidden' | 'bad_request'; message: string }
  > {
    if (path.includes('..')) return { ok: false, code: 'forbidden', message: 'outside workspace' }
    if (path === 'missing.ts') return { ok: false, code: 'not_found', message: 'not_found' }
    if (path.endsWith('.png')) return { ok: true, value: { path, content: '', size: 0, truncated: false, binary: true } }
    return {
      ok: true,
      value: {
        path,
        content: `// ${path}\nexport const line2 = 2\nexport function demo() {\n  return line2\n}\n`,
        size: 76,
        truncated: false,
      },
    }
  }
  async usageSummary(days: number): Promise<UsageSummaryResult> {
    return {
      days,
      calls: 42,
      sessions: 5,
      input: 120_000,
      output: 34_000,
      cacheRead: 980_000,
      cacheWrite: 90_000,
      cost: 3.48,
      cacheHitRate: 0.82,
      avgTtftMs: 1180,
      genTps: 72.5,
      byModel: [{ model: 'anthropic/sonnet-5', calls: 42, input: 120_000, output: 34_000, cacheRead: 980_000, cost: 3.48 }],
      byDay: [{ day: '2026-10-08', calls: 14, tokens: 410_000, cost: 1.12 }],
    }
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
  notifySettingsChanged(key: 'cacheWarming' | 'capabilities' | 'rewound' | 'purge'): void {
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
