import type { z } from 'zod'
import { REMOTE_EVENTS, type RemoteEvent } from './events'
import { REMOTE_METHODS, type RemoteMethod } from './methods'
import type { RenderNode, Turn, TurnPatch } from './timeline'
import { emptyActivityCounts } from './timeline'
import type { UiRequest } from './ui'

/**
 * Canonical samples of every message, written to `fixtures/messages/*.json` and decoded by the
 * Kotlin client tests. Keep them realistic and cover optional fields at least once.
 */

export type MessageFixture = { name: string; schema: string; value: unknown }

const sessionKey = '/home/u/.pi/agent/sessions/--work-pi-app--/2026-10-05T14-02-11_a1b2.jsonl'

const bashNode: RenderNode = {
  template: 'bash',
  title: 'npm test -- auth',
  status: 'ok',
  fields: { command: 'npm test -- auth', exitCode: 0 },
  preview: 'Tests  3 passed (3)',
  detail: true,
  fallbackText: '运行 npm test -- auth',
}

export const sampleTurnDone: Turn = {
  id: 't-entry-41',
  anchor: 'entry-41',
  status: 'done',
  startedAt: 1791205320000,
  durationMs: 134000,
  user: { text: '按这个方案修，顺便补个测试' },
  activity: { counts: { ...emptyActivityCounts(), read: 3, edit: 2, write: 1, run: 2, think: 1 }, failed: 0, thinkingMs: 11000 },
  steps: [
    { id: 's1', kind: 'thinking', text: 'Need single-flight refresh.', ms: 11000 },
    {
      id: 's2',
      kind: 'tool',
      toolCallId: 'call_7',
      toolName: 'edit',
      category: 'edit',
      status: 'ok',
      ms: 820,
      node: {
        template: 'edit',
        title: 'src/auth/refresh.ts',
        icon: 'pencil',
        status: 'ok',
        fields: { path: 'src/auth/refresh.ts', add: 16, del: 4 },
        preview: '@@ -38,9 +40,18 @@\n-  const res = await client.post(\'/auth/refresh\')\n+  if (inflight) return inflight',
        fallbackText: '改 src/auth/refresh.ts +16 −4',
      },
    },
    { id: 's3', kind: 'prose', text: '先改刷新逻辑，再补测试。' },
    {
      id: 's4',
      kind: 'tool',
      toolCallId: 'call_9',
      toolName: 'bash',
      category: 'run',
      status: 'ok',
      node: bashNode,
    },
  ],
  answer: '修好了。刷新改成单飞：\n\n```ts\nif (inflight) return inflight\n```\n',
  files: [
    { path: 'src/auth/refresh.ts', add: 16, del: 4 },
    { path: 'test/auth/refresh.test.ts', add: 72, del: 0 },
  ],
  meta: { model: 'anthropic/sonnet-5', thinking: 'high' },
}

export const sampleTurnRunning: Turn = {
  id: 'live:turn-88',
  anchor: 'live:turn-88',
  status: 'running',
  startedAt: 1791205740000,
  user: { text: '再跑一遍完整的 typecheck 和 lint', images: 1 },
  activity: { counts: { ...emptyActivityCounts(), run: 2, read: 1 }, failed: 0, live: 's9' },
  steps: [
    {
      id: 's9',
      kind: 'tool',
      toolCallId: 'call_21',
      toolName: 'bash',
      category: 'run',
      status: 'running',
      node: { template: 'bash', title: 'npm run lint', status: 'running', fields: { command: 'npm run lint' }, fallbackText: '运行 npm run lint' },
    },
  ],
  answer: '',
  files: [],
}

const patches: TurnPatch[] = [
  { op: 'turn.upsert', seq: 1, turn: sampleTurnRunning },
  {
    op: 'step.upsert',
    seq: 2,
    turnId: 'live:turn-88',
    step: { id: 's10', kind: 'thinking', text: 'lint passed' },
    counts: { ...emptyActivityCounts(), run: 2, read: 1, think: 1 },
    failed: 0,
    live: 's10',
  },
  { op: 'text.append', seq: 3, seqTo: 4, turnId: 'live:turn-88', ref: 'answer', delta: '全部通过。' },
  { op: 'turn.promote', seq: 5, turnId: 'live:turn-88', step: { id: 's11', kind: 'prose', text: '全部通过。' } },
  {
    op: 'turn.settle',
    seq: 6,
    turnId: 'live:turn-88',
    status: 'failed',
    durationMs: 42000,
    files: [],
    error: { kind: 'error', text: 'lint exited with 1' },
  },
  {
    op: 'session.state',
    seq: 7,
    state: { running: false, model: 'anthropic/sonnet-5', thinking: 'high', availableThinking: ['off', 'low', 'high'], queue: { steering: [], followUp: ['更新 CHANGELOG'] }, todo: { title: '待办', items: [{ id: '1', text: '写测试', status: 'in_progress', priority: 'high' }, { id: '2', text: '提交', status: 'pending' }] } },
  },
]

const uiRequests: UiRequest[] = [
  { id: 'u1', sessionKey, method: 'select', title: '选择环境', options: ['dev', 'prod'], timeout: 60000 },
  { id: 'u2', sessionKey, method: 'confirm', title: '删除文件？', message: '将删除 3 个文件' },
  { id: 'u3', sessionKey, method: 'input', title: '分支名', placeholder: 'feat/…' },
  { id: 'u4', sessionKey, method: 'editor', title: '提交说明', prefill: 'fix: …' },
  { id: 'u5', sessionKey, method: 'notify', message: '已同步', notifyType: 'info' },
  {
    id: 'u6',
    sessionKey,
    method: 'custom',
    kind: 'ask_user_question',
    toolCallId: 'call_3',
    questions: [
      {
        question: '旧导出要一起删掉吗？',
        header: '迁移',
        multiSelect: false,
        options: [{ label: '删除', description: '统一从 shared 导入' }, { label: '保留一个版本', hasPreview: true, preview: 'export * from …' }],
      },
    ],
  },
  {
    id: 'u7',
    sessionKey,
    method: 'custom',
    kind: 'image_review',
    image: 'data:image/png;base64,iVBORw0KGgo=',
    title: '确认截图',
    question: '这样可以吗？',
    context: '设置页',
    options: ['可以', '重做'],
    allowFeedback: true,
  },
]

type Samples = { [M in RemoteMethod]: { params: z.infer<(typeof REMOTE_METHODS)[M]['params']>; result: z.infer<(typeof REMOTE_METHODS)[M]['result']> } }

const methodSamples: Samples = {
  'host.hello': {
    params: { app: { name: 'pi-remote', version: '0.1.0', platform: 'android-35' }, caps: { templates: ['bash', 'edit', 'default'], piUi: ['chart', 'gantt'], uiKinds: ['select', 'ask_user_question'] } },
    result: {
      hostId: 'h_9f2c',
      hostName: 'justhil-desktop',
      version: '0.7.0',
      epoch: 'e_3b1f',
      deviceId: 'd_77aa',
      role: 'operator',
      features: ['capabilities', 'cacheWarming'],
      assets: [{ name: 'mermaid.min.js', sha256: 'ab'.repeat(32), size: 2_900_000 }],
      endpoints: ['ws://192.168.1.23:47900', 'ws://10.0.0.5:47900'],
    },
  },
  'project.list': { params: {}, result: { projects: [{ id: '/work/pi-app', name: 'pi-app' }, { id: '/home/me/.config/pi-desktop/sandbox-workspaces/02c9a317', name: '帮我看下这个报错', temporary: true }] } },
  'session.watchList': {
    params: { projectId: '/work/pi-app' },
    result: {
      sessions: [
        {
          sessionKey,
          projectId: '/work/pi-app',
          title: '修复登录页 token 刷新',
          status: 'running',
          updatedAt: 1791205782000,
          live: 'npm run lint',
          liveCategory: 'run',
          startedAt: 1791205740000,
          counts: { ...emptyActivityCounts(), read: 4, edit: 3, run: 3 },
          filesChanged: 3,
        },
        { sessionKey: sessionKey + '2', projectId: '/work/pi-app', title: '迁移', status: 'needsInput', updatedAt: 1791205600000, preview: '旧导出要一起删掉吗？' },
      ],
    },
  },
  'session.unwatchList': { params: {}, result: {} },
  'session.open': {
    params: { sessionKey, cursor: { epoch: 'e_3b1f', seq: 120 } },
    result: {
      sessionKey,
      title: '修复登录页 token 刷新',
      epoch: 'e_3b1f',
      seq: 126,
      kind: 'snapshot',
      resync: 'gap',
      turns: [sampleTurnDone, sampleTurnRunning],
      hasOlder: true,
      state: { running: true, model: 'anthropic/sonnet-5', thinking: 'high' },
      pendingUi: [uiRequests[0]],
    },
  },
  'session.close': { params: { sessionKey }, result: {} },
  'turn.page': { params: { sessionKey, before: 'entry-41', limit: 20 }, result: { turns: [sampleTurnDone], hasOlder: false } },
  'turn.toolDetail': {
    params: { sessionKey, toolCallId: 'call_9' },
    result: { node: bashNode, output: 'full output' },
  },
  'turn.send': { params: { sessionKey, text: '顺便更新 CHANGELOG', mode: 'followUp', clientMessageId: 'm_01JABCDEF' }, result: { accepted: true, duplicate: false } },
  'turn.abort': { params: { sessionKey }, result: { aborted: true, restored: ['顺便更新 CHANGELOG'] } },
  'turn.dequeue': { params: { sessionKey }, result: { restored: ['顺便更新 CHANGELOG'] } },
  'session.create': { params: { projectId: '/work/pi-app', capabilities: ['pi-ui'] }, result: { sessionKey } },
  'model.list': {
    params: { sessionKey },
    result: { models: [{ id: 'local/qwen-coder', name: 'Qwen Coder', provider: 'local', group: 'custom' }, { id: 'anthropic/sonnet-5', name: 'Sonnet 5', provider: 'anthropic', group: 'login' }], current: 'anthropic/sonnet-5', thinking: 'high', availableThinking: ['off', 'low', 'medium', 'high'] },
  },
  'model.set': { params: { sessionKey, modelId: 'anthropic/sonnet-5' }, result: { model: 'anthropic/sonnet-5' } },
  'attachment.upload': {
    params: { name: 'IMG_0412.jpg', mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
    result: { path: '/home/me/.config/pi-desktop/clipboard-images/pi-clipboard-3f2a-IMG_0412.jpg', name: 'IMG_0412.jpg', size: 10 },
  },
  'attachment.get': {
    params: { path: '/home/me/.config/pi-desktop/clipboard-images/pi-clipboard-3f2a-IMG_0412.jpg' },
    result: { mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
  },
  'thinking.set': { params: { sessionKey, level: 'medium' }, result: { level: 'medium' } },
  'command.list': {
    params: { sessionKey },
    result: {
      commands: [
        { name: '/review', description: 'Review the current diff', category: 'prompt' },
        { name: '/skill:pdf', description: 'Read and fill PDF forms', category: 'skill' },
        { name: '/todos', category: 'extension' },
      ],
    },
  },
  'file.list': {
    params: { sessionKey, path: 'src' },
    result: {
      entries: [
        { name: 'main', path: 'src/main', dir: true, mtime: 1760000000000 },
        { name: 'index.ts', path: 'src/index.ts', dir: false, size: 2048, mtime: 1760000000000 },
      ],
      truncated: false,
    },
  },
  'file.search': {
    params: { sessionKey, query: 'auth' },
    result: { entries: [{ name: 'auth.ts', path: 'src/auth.ts', dir: false }] },
  },
  'capability.list': {
    params: { sessionKey },
    result: { capabilities: [{ id: 'pi-ui', available: true, promptTokens: 2410, tools: 0, enabled: true }, { id: 'browser', available: false, reason: 'browser-panel-off', promptTokens: 3100, tools: 24, enabled: false }] },
  },
  'capability.set': { params: { sessionKey, id: 'pi-ui', on: true }, result: { enabled: ['pi-ui'] } },
  'settings.cacheWarming.get': { params: {}, result: { mode: 'streaming' } },
  'settings.cacheWarming.set': { params: { mode: 'idle' }, result: { mode: 'idle' } },
  'ui.respond': { params: { id: 'u6', result: { cancelled: false, answers: [] } }, result: { accepted: true } },
  'ui.cancel': { params: { id: 'u1' }, result: { accepted: false } },
}

type EventSamples = { [E in RemoteEvent]: z.infer<(typeof REMOTE_EVENTS)[E]>[] }

const eventSamples: EventSamples = {
  'sessions.update': [{ sessions: methodSamples['session.watchList'].result.sessions, removed: ['/gone.jsonl'] }],
  'turn.patch': [{ sessionKey, patches }],
  'ui.request': uiRequests,
  'ui.dismiss': [{ id: 'u6', sessionKey, by: 'desktop' }],
  'settings.changed': [{ key: 'capabilities', sessionKey }, { key: 'cacheWarming' }],
  'host.notice': [{ level: 'warning', text: '桌面即将退出' }],
}

export function messageFixtures(): MessageFixture[] {
  const out: MessageFixture[] = []
  for (const [m, s] of Object.entries(methodSamples)) {
    out.push({ name: `method.${m}.params`, schema: `${m}/params`, value: s.params })
    out.push({ name: `method.${m}.result`, schema: `${m}/result`, value: s.result })
  }
  for (const [e, list] of Object.entries(eventSamples)) {
    list.forEach((value, i) => out.push({ name: `event.${e}.${i}`, schema: `${e}/event`, value }))
  }
  return out
}
