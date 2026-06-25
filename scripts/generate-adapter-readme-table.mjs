/**
 * Generate doc/guide/adapters.en.md and doc/guide/adapters.zh-CN.md
 * Run: npm run docs:adapters
 */
import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const builtinDir = join(root, 'src', 'extension-compat', 'builtin')
const outDir = join(root, 'doc', 'guide')

function pkgCell(names) {
  const n = names?.[0]
  if (!n) return '—'
  if (n.includes('/')) return `\`${n}\``
  return `[\`${n}\`](https://www.npmjs.com/package/${encodeURIComponent(n)})`
}

function esc(s) {
  return (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const files = (await readdir(builtinDir)).filter((f) => f.endsWith('.adapter.json')).sort()
  const rows = []
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(builtinDir, f), 'utf8'))
    rows.push({
      display: raw.displayName || raw.id || f.replace('.adapter.json', ''),
      pkg: raw.match?.names || [],
      zh: esc(raw.i18n?.zh?.description || raw.description),
      en: esc(raw.i18n?.en?.description || raw.description),
      tier: raw.tier || '—',
    })
  }

  const enIntro = `<!-- AUTO-GENERATED — do not edit by hand -->

# Built-in extension adapters

**[简体中文](./adapters.zh-CN.md)**

Generated from \`src/extension-compat/builtin/*.adapter.json\` (${rows.length} adapters).

1. Install in terminal pi: \`pi install npm:<name>\` or \`pi install git:...\`
2. Enable in \`~/.pi/agent/settings.json\` → \`packages\`
3. Restart the desktop **worker session**

| Adapter | Package | Tier | Description |
|---------|---------|------|-------------|
`

  const enBody = rows.map((r) => `| ${r.display} | ${pkgCell(r.pkg)} | ${r.tier} | ${r.en || r.zh} |`).join('\n')

  const enFooter = `

Authoring: [adapter-authoring-guide.md](../adapter-authoring-guide.md) · [doc/README.md](../README.md)
`

  const zhIntro = `<!-- AUTO-GENERATED — do not edit by hand -->

# 内置扩展适配器

**[English](./adapters.en.md)**

由 \`src/extension-compat/builtin/*.adapter.json\` 自动生成（${rows.length} 个）。

1. 终端安装：\`pi install npm:<包名>\` 或 \`pi install git:...\`
2. 在 \`~/.pi/agent/settings.json\` → \`packages\` 启用
3. 桌面端 **重启 Worker 会话**

| 适配器 | 扩展包 | Tier | 说明 |
|--------|--------|------|------|
`

  const zhBody = rows.map((r) => `| ${r.display} | ${pkgCell(r.pkg)} | ${r.tier} | ${r.zh || r.en} |`).join('\n')

  const zhFooter = `

编写适配器：[adapter-authoring-guide.md](../adapter-authoring-guide.md) · [doc/README.zh-CN.md](../README.zh-CN.md)
`

  await writeFile(join(outDir, 'adapters.en.md'), enIntro + enBody + enFooter, 'utf8')
  await writeFile(join(outDir, 'adapters.zh-CN.md'), zhIntro + zhBody + zhFooter, 'utf8')
  console.log('Wrote doc/guide/adapters.en.md and adapters.zh-CN.md', `(${rows.length} rows)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})