// Demo content shared by the seeded sessions and the scripted model endpoint,
// so the static screenshots and the recorded turn always tell the same story.

export const PROJECT_FILES = {
  'package.json': `${JSON.stringify({ name: 'lumen', version: '0.3.0', type: 'module', bin: { lumen: './src/cli.mjs' }, scripts: { test: 'node --test' } }, null, 2)}\n`,
  'README.md': '# lumen\n\nA tiny link checker for Markdown notes.\n\n```sh\nlumen check notes/\n```\n',
  'src/links.mjs': `// Extract [text](url) links from Markdown.
const LINK = /\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g

export function parseLinks(markdown) {
  const links = []
  for (const match of markdown.matchAll(LINK)) {
    links.push({ text: match[1], url: match[2] })
  }
  return links
}

export function isExternal(url) {
  return /^https?:\\/\\//.test(url)
}
`,
  'src/links.test.mjs': `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLinks } from './links.mjs'

test('parses plain links', () => {
  assert.deepEqual(parseLinks('see [docs](./docs.md)'), [{ text: 'docs', url: './docs.md' }])
})

test('parses links with a title', () => {
  assert.deepEqual(parseLinks('[pi](https://pi.dev "Pi agent")'), [
    { text: 'pi', url: 'https://pi.dev', title: 'Pi agent' },
  ])
})
`,
  'src/cli.mjs': `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseLinks, isExternal } from './links.mjs'

const [, , command, file] = process.argv
if (command !== 'check' || !file) {
  console.error('usage: lumen check <file.md>')
  process.exit(1)
}
for (const link of parseLinks(readFileSync(file, 'utf8'))) {
  console.log(isExternal(link.url) ? 'external' : 'local   ', link.url)
}
`,
}

export const MODEL = { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', api: 'openai-completions' }

const TEXT = {
  zh: {
    fixTitle: '修复带标题的 Markdown 链接解析',
    fixPrompt: '`npm test` 里 “parses links with a title” 失败了，帮我修好 `parseLinks`，保持现有行为不变。',
    thinkTests: '先跑一遍测试，确认失败的是哪条用例。',
    thinkRead: '带标题的链接没有被解析，看一下解析正则。',
    thinkEdit: '正则在 URL 后直接要求 `)`，空格加 "标题" 不匹配。加一个可选标题捕获组，无标题时不写 title 字段，保持旧行为。',
    thinkDone: '测试通过，总结原因与改动。',
    readmeLine: '支持带标题的链接：`[pi](https://pi.dev "Pi agent")`。',
    final: `已修复，两个测试全部通过。

**原因**：\`LINK\` 正则要求 URL 后紧跟 \`)\`，\`[pi](https://pi.dev "Pi agent")\` 中的空格和标题让整条链接匹配失败。

**改动**：
- \`src/links.mjs\`：正则新增可选的 \`\\s+"标题"\` 捕获组，只有存在标题时才写入 \`title\`
- \`README.md\`：补充带标题链接的用法`,
    jsonTitle: '给 CLI 加上 --json 输出',
    jsonPrompt: '给 `lumen check` 加一个 `--json` 选项，方便在 CI 里解析结果。',
    jsonReply: '已确认入口结构。`--json` 会输出 `{ url, external }` 数组，不影响现有的纯文本模式。需要我顺便补上 README 用法吗？',
    planTitle: '规划 v0.4：远程链接检查',
    planPrompt: '下个版本想检查外链是否 404，先帮我列一个实现计划，暂时不要改代码。',
    planReply: '计划分三步：\n\n1. **抓取层**：`fetchStatus(url)` 使用 `HEAD`，失败时回退 `GET`，超时 5 秒\n2. **并发控制**：同一域名最多 4 个请求，结果按 URL 缓存\n3. **CLI**：`lumen check --remote`，非 2xx/3xx 时退出码为 1\n\n需要我先写第 1 步的测试吗？',
    mentionBefore: '先给 ',
    mentionAfter: ' 写第 1 步的测试',
    remotePrompt: '只读分析：`--remote` 该接在 CLI 的哪一层？先别改代码。',
    remoteThinkLs: '先看看源码目录的结构。',
    remoteThinkRead: '命令分发都在 cli.mjs，看它怎么处理参数。',
    remoteFinal: `建议把 \`--remote\` 接在 **CLI 层**，解析器保持纯函数：

1. \`cli.mjs\` 解析 \`--remote\`，拿到 \`parseLinks()\` 的结果后只挑出外链
2. 新增 \`src/remote.mjs\`，导出 \`checkRemote(urls)\`，负责并发与超时
3. 有失败链接时以退出码 1 结束，方便 CI 判断

\`links.mjs\` 不需要改动。`,
  },
  en: {
    fixTitle: 'Fix Markdown links with titles',
    fixPrompt: '"parses links with a title" fails in `npm test`. Please fix `parseLinks` without changing existing behaviour.',
    thinkTests: 'Run the tests first to see which case fails.',
    thinkRead: 'Titled links are not parsed; look at the regex.',
    thinkEdit: 'The regex requires `)` right after the URL. Add an optional title group and only set `title` when present to keep old results unchanged.',
    thinkDone: 'Tests pass; summarise.',
    readmeLine: 'Links with a title are supported: `[pi](https://pi.dev "Pi agent")`.',
    final: `Fixed — both tests pass now.

**Cause**: the \`LINK\` regex expected \`)\` right after the URL, so the space and title in \`[pi](https://pi.dev "Pi agent")\` made the whole link fail to match.

**Changes**:
- \`src/links.mjs\`: optional \`\\s+"title"\` group; \`title\` is only set when present
- \`README.md\`: documents titled links`,
    jsonTitle: 'Add --json output to the CLI',
    jsonPrompt: 'Add a `--json` flag to `lumen check` so CI can parse the result.',
    jsonReply: 'Checked the entry point. `--json` will print an array of `{ url, external }` and keep the plain-text mode unchanged. Want me to document it in the README too?',
    planTitle: 'Plan v0.4: remote link checks',
    planPrompt: 'Next release should flag external links that 404. Draft an implementation plan first — no code changes yet.',
    planReply: 'Three steps:\n\n1. **Fetch layer**: `fetchStatus(url)` uses `HEAD`, falls back to `GET`, 5s timeout\n2. **Concurrency**: at most 4 requests per host, results cached by URL\n3. **CLI**: `lumen check --remote` exits 1 on any non-2xx/3xx\n\nShall I start with tests for step 1?',
    mentionBefore: 'Write tests for ',
    mentionAfter: ' covering step 1',
    remotePrompt: 'Read-only: where should `--remote` hook into the CLI? No edits yet.',
    remoteThinkLs: 'Start with the layout of the source folder.',
    remoteThinkRead: 'Command dispatch lives in cli.mjs; check how it handles arguments.',
    remoteFinal: `Hook \`--remote\` in at the **CLI layer** and keep the parser pure:

1. \`cli.mjs\` parses \`--remote\` and passes only external URLs from \`parseLinks()\` on
2. a new \`src/remote.mjs\` exports \`checkRemote(urls)\` and owns concurrency and timeouts
3. exit with code 1 when any link fails, so CI can gate on it

\`links.mjs\` stays unchanged.`,
  },
}

export function text(lang) {
  return TEXT[lang]
}

/** The fix turn as an ordered list of model steps; tools run for real against the demo repo. */
export function fixTurnSteps(lang) {
  const t = TEXT[lang]
  return [
    { thinking: t.thinkTests, tool: { name: 'bash', args: { command: 'node --test --test-reporter=spec 2>&1 | head -n 10' } } },
    { thinking: t.thinkRead, tool: { name: 'read', args: { path: 'src/links.mjs' } } },
    {
      thinking: t.thinkEdit,
      tool: {
        name: 'edit',
        args: {
          path: 'src/links.mjs',
          edits: [
            { oldText: 'const LINK = /\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g', newText: 'const LINK = /\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)/g' },
            { oldText: '    links.push({ text: match[1], url: match[2] })', newText: '    const [, text, url, title] = match\n    links.push(title === undefined ? { text, url } : { text, url, title })' },
          ],
        },
      },
    },
    { tool: { name: 'bash', args: { command: 'node --test --test-reporter=spec 2>&1 | tail -n 9' } } },
    {
      tool: {
        name: 'edit',
        args: { path: 'README.md', edits: [{ oldText: '```sh\nlumen check notes/\n```\n', newText: `\`\`\`sh\nlumen check notes/\n\`\`\`\n\n${t.readmeLine}\n` }] },
      },
    },
    { thinking: t.thinkDone, text: t.final },
  ]
}

/** A read-only turn used alongside the fix turn in the parallel-sessions recording. */
export function remoteTurnSteps(lang) {
  const t = TEXT[lang]
  return [
    { thinking: t.remoteThinkLs, tool: { name: 'bash', args: { command: 'ls -la src' } } },
    { thinking: t.remoteThinkRead, tool: { name: 'read', args: { path: 'src/cli.mjs' } } },
    { text: t.remoteFinal },
  ]
}
