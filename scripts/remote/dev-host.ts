import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { RemoteGateway, lanAddresses } from '../../src/main/remote/gateway'
import { FakeHost } from '../../src/main/remote/testing/fake-host'

/**
 * Real gateway + in-memory desktop for phone development and no-phone e2e checks.
 *   node scripts/remote-dev-host.mjs            # LAN + loopback, port 47901
 *   PI_REMOTE_PORT=47950 PI_REMOTE_LOOPBACK_ONLY=1 node scripts/remote-dev-host.mjs
 * The current pairing (link + parts) is written to PI_REMOTE_PAIR_FILE (default
 * node_modules/.cache/remote-dev/pair.json) and re-issued as soon as a phone consumes it.
 */

const port = Number(process.env.PI_REMOTE_PORT || 47901)
const loopbackOnly = process.env.PI_REMOTE_LOOPBACK_ONLY === '1'
const pairFile = process.env.PI_REMOTE_PAIR_FILE || 'node_modules/.cache/remote-dev/pair.json'
const stepMs = Number(process.env.PI_REMOTE_STEP_MS || 250)
/** Extra endpoint hosts for the QR, e.g. 10.0.2.2 for the Android emulator. */
const extraHosts = (process.env.PI_REMOTE_EXTRA_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)

const host = new FakeHost({ projects: ['/work/pi-app', '/work/blog'], stepMs })
// Serve mermaid like the desktop does, so phones exercise the hash-checked download.
host.assetPath = (name: string) => (name === 'mermaid.min.js' ? resolve('node_modules/mermaid/dist/mermaid.min.js') : null)
host.store.set('remote', { enabled: true, port, hostId: 'h_dev', devices: [], projects: ['/work/pi-app', '/work/blog'] })

const chart = JSON.stringify({
  component: 'chart',
  id: 'ci-weekly',
  props: { title: '构建耗时（周）', type: 'bar', x: ['W36', 'W37', 'W38', 'W39', 'W40', 'W41'], series: [{ name: '中位耗时', data: [5.8, 6, 6.3, 6.1, 6.6, 6.7] }, { name: '失败率', type: 'line', axis: 'right', data: [4.4, 4.1, 3.9, 4, 3.5, 3.2] }], unit: 'min', rightUnit: '%' },
})
const stats = JSON.stringify({
  component: 'stat-grid',
  id: 'ci-kpi',
  props: { items: [{ label: '构建次数', value: '1,284', delta: '+6.1%' }, { label: '失败率', value: '3.2', unit: '%', delta: '-0.3pt', trend: 'up', history: [4.4, 4.1, 3.9, 4, 3.5, 3.2] }, { label: '中位耗时', value: '6m 41s', delta: '+12%', trend: 'down' }, { label: '缓存命中', value: '87', unit: '%', delta: '+4pt' }] },
})
const gantt = JSON.stringify({
  component: 'gantt',
  id: 'mvp-plan',
  props: { title: '手机端 MVP 排期', today: '2026-10-05', tasks: [{ id: 'plan', name: '方案与原型', start: '2026-10-01', end: '2026-10-07', progress: 0.8 }, { id: 'schema', name: 'schema', group: '协议', start: '2026-10-06', end: '2026-10-09', dependsOn: 'plan' }, { id: 'gw', name: '网关', group: '网关', start: '2026-10-10', end: '2026-10-16', dependsOn: 'schema' }, { id: 'app', name: 'timeline', group: 'Android', start: '2026-10-15', end: '2026-10-23', dependsOn: 'gw' }, { id: 'beta', name: '内测', start: '2026-10-29', milestone: true, dependsOn: 'app' }] },
})
const table = JSON.stringify({
  component: 'data-table',
  id: 'slow-jobs',
  props: { title: '最慢的 job', columns: [{ key: 'job', label: 'job' }, { key: 'dur', label: '中位耗时 (s)', type: 'number' }, { key: 'fail', label: '失败率 (%)', type: 'number' }], rows: [{ job: 'e2e:playwright', dur: 252, fail: 6.1 }, { job: 'build:win', dur: 228, fail: 2.4 }, { job: 'test:unit', dur: 115, fail: 0.9 }, { job: 'typecheck', dur: 81, fail: 0 }] },
})

host.addSession('/work/pi-app', '修复登录页 token 刷新', [
  { user: '登录页偶尔会报 401，帮我查一下原因', answer: '原因是**并发刷新**：多个请求同时调用 `refreshSession`，第一次刷新后旧 token 失效，后面几次拿到 401。\n\n- 刷新没有做单飞合并\n- 定时刷新卡在过期瞬间', tools: [{ name: 'grep', args: { pattern: 'refreshToken', path: 'src' }, output: 'src/auth/refresh.ts:12\nsrc/auth/login.ts:40' }, { name: 'read', args: { path: 'src/auth/refresh.ts' }, output: 'export async function refreshSession() {}' }] },
  {
    user: '按这个方案修，顺便补个测试',
    answer: '修好了。刷新改成单飞，定时刷新提前 30 秒：\n\n```ts\nif (inflight) return inflight\ninflight = client.post(\'/auth/refresh\').finally(() => { inflight = null })\n```\n',
    tools: [
      { name: 'edit', args: { path: 'src/auth/refresh.ts', edits: [{ oldText: 'const res = await client.post()\nreturn res', newText: 'if (inflight) return inflight\ninflight = client.post()\nreturn inflight' }] }, output: 'ok' },
      { name: 'write', args: { path: 'test/auth/refresh.test.ts', content: 'test("single flight", () => {})\n'.repeat(12) }, output: 'ok' },
      { name: 'bash', args: { command: 'npm test -- auth' }, output: ' ✓ test/auth/refresh.test.ts (3 tests)\n Test Files  1 passed (1)' },
    ],
  },
])
host.addSession('/work/pi-app', 'CI 构建情况回顾', [
  { user: '看一下最近 6 周 CI 的情况，画出来', answer: `构建更稳了，但变慢了：\n\n\`\`\`pi-ui\n${stats}\n\`\`\`\n\n\`\`\`pi-ui\n${chart}\n\`\`\`\n\n- W40 起 e2e 加了截图对比\n\n\`\`\`pi-ui\n${table}\n\`\`\`\n`, tools: [{ name: 'bash', args: { command: 'gh run list --limit 200 --json conclusion,duration' }, output: '[…200 runs…]' }] },
  { user: '顺便把手机端 MVP 的排期画一下', answer: `关键路径是 schema → 网关 → timeline：\n\n\`\`\`pi-ui\n${gantt}\n\`\`\`\n` },
])
host.addSession('/work/pi-app', '手机连接设置页草图', [
  {
    user: '给手机连接设置页出个 HTML 草图，再讲一下配对流程和凭据',
    answer:
      '草图放在下面：\n\n```html\n<section class="card"><h2>手机连接</h2><input type="checkbox" role="switch" checked></section>\n```\n\n### 配对流程\n\n1. 扫码拿到主机公钥和一次性配对码\n2. Noise IK 握手\n3. 签发设备凭据\n\n```mermaid\nflowchart TD\n  A[扫码] --> B[握手] --> C[设备凭据]\n```\n\n| 凭据 | 有效期 | 存放 |\n|---|---|---|\n| 配对码 | 5 分钟 | 二维码 |\n| 设备密钥 | 直到解绑 | Keystore |\n\n重连退避 $t_n = \\min(30, 2^n)$ 秒。\n\n> 局域网之外的连接放到中继阶段。\n\n- [x] 二维码\n- [ ] 项目白名单\n',
  },
])
host.addSession('/work/pi-app', '退避公式推导', [
  {
    user: '解释一下重连退避的公式',
    answer: '退避时间 $t_n = \\min(30, 2^n)$ 秒，期望等待 $E[T] = \\sum_{k=0}^{n} 2^k = 2^{n+1} - 1$。\n\n当 $n \\to \\infty$ 时上限为：\n\n$$\nT_{\\max} = \\lim_{n\\to\\infty} \\sum_{k=0}^{n} \\min(30, 2^k) = \\infty\n$$\n\n矩阵形式：\\[ A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} \\]\n\n成本 $13.43/task 比原来的 $3.97 高。',
  },
])
host.addSession('/work/blog', '博客：本地优先的同步策略', [{ user: '写第三节', answer: '草稿已写到第三节，等你补充性能数据。' }])

const gw = new RemoteGateway(host)
host.sink = gw.sink
gw.endpointHosts = () => [...extraHosts, ...(loopbackOnly ? ['127.0.0.1'] : [...lanAddresses(), '127.0.0.1'])]

function writePairing(): void {
  const p = gw.regeneratePairing()
  if (!p) return
  const pairing = gw.auth.currentPairing!
  mkdirSync(dirname(pairFile), { recursive: true })
  writeFileSync(pairFile, JSON.stringify({ link: p.link, exp: p.exp, token: pairing.token, endpoints: gw.endpoints() }, null, 2))
  console.log(`[dev-host] pairing link (expires ${new Date(p.exp).toLocaleTimeString()}):\n${p.link}`)
}

await gw.start({ port, host: loopbackOnly ? '127.0.0.1' : '0.0.0.0' })
console.log(`[dev-host] gateway on :${gw.boundPort} — endpoints ${gw.endpoints().join(', ')}`)
writePairing()
// Keep a fresh pairing available: re-issue when consumed or about to expire.
setInterval(() => {
  const cur = gw.auth.currentPairing
  if (!cur || cur.exp - Date.now() < 30_000) writePairing()
}, 300)

const stop = async () => {
  await gw.stop()
  host.dispose()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
