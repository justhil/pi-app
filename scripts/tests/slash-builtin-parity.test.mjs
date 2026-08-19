import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.cwd()

/** 真实 pi 内置命令名（以应用内置 SDK 包为准；文件 URL 导入绕过 exports map）。 */
async function realBuiltinNames() {
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
  const slashJs = join(dirname(fileURLToPath(entry)), 'core/slash-commands.js')
  const mod = await import(pathToFileURL(slashJs).href)
  return mod.BUILTIN_SLASH_COMMANDS.map((b) => b.name)
}

/** 从 TS 源码提取 `const NAME = new Set([...])` 的字面量成员（与 ipc-channel-sync 同模式）。 */
function extractSetEntries(file, varName) {
  const src = readFileSync(file, 'utf8')
  const re = new RegExp(`const ${varName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`)
  const m = src.match(re)
  assert.ok(m, `set ${varName} found in ${file}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('slash builtin completeness sync', () => {
  it('fallback set matches the real pi builtin list exactly', async () => {
    const real = (await realBuiltinNames()).sort()
    const fallback = extractSetEntries(
      join(root, 'src/renderer/src/features/composer/slash-catalog.ts'),
      'FALLBACK_PI_BUILTIN_NAMES',
    ).sort()

    assert.deepEqual(
      fallback,
      real,
      'pi 新增/删除内置命令时，须同步更新 slash-catalog.ts 的 FALLBACK_PI_BUILTIN_NAMES（同步清单未就绪前的拦截兜底）',
    )
  })

  it('every pi builtin is intercepted before reaching the model', async () => {
    const real = new Set(await realBuiltinNames())
    const fallback = new Set(
      extractSetEntries(
        join(root, 'src/renderer/src/features/composer/slash-catalog.ts'),
        'FALLBACK_PI_BUILTIN_NAMES',
      ),
    )
    const native = extractSetEntries(
      join(root, 'src/renderer/src/features/composer/slash-exec.ts'),
      'APP_NATIVE',
    )
    const covered = new Set([...native, ...fallback])

    for (const name of real) {
      assert.ok(covered.has(name), `pi builtin /${name} 未被拦截（会泄漏给模型）`)
    }
  })
})
