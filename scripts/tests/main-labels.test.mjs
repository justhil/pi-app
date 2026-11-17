import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The main process writes a handful of labels itself (worker fatal, git/WSL/pool errors,
 * the new-session title). They live in packages/shared/main-labels.ts, keyed by language -
 * this contract keeps en/zh/ru carrying the same keys and forbids hardcoded CJK copies in
 * the main sources that use them.
 */
const SRC = readFileSync(join(process.cwd(), 'packages/shared/main-labels.ts'), 'utf8')

const LANGS = ['zh', 'en', 'ru']

function keysOf(language) {
  const start = SRC.indexOf(`  ${language}: {`)
  assert.ok(start >= 0, `${language} block missing in main-labels.ts`)
  const end = SRC.indexOf('\n  },', start)
  assert.ok(end > start, `${language} block not closed`)
  const body = SRC.slice(start, end)
  return [...body.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]).sort()
}

describe('main process labels', () => {
  it('en, zh and ru carry the same keys', () => {
    const zh = keysOf('zh')
    assert.ok(zh.length >= 16, `expected the main label set, got ${zh.length}`)
    for (const language of LANGS.filter((l) => l !== 'zh')) {
      assert.deepEqual(keysOf(language), zh, `main-labels ${language} keys differ from zh`)
    }
  })

  it('main sources read labels through mainLabel instead of literals', () => {
    const files = [
      'src/main/git-workspace.ts',
      'src/main/worker-manager.ts',
      'src/main/worker-manager-pool.ts',
      'src/main/wsl/sdk-resolve.ts',
      'src/main/wsl/session-preview-runner.ts',
      'src/main/agent-purge-service.ts',
      'src/main/ipc/handlers/session.ts',
    ]
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      const userFacing = src
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) =>
            !line.startsWith('//') &&
            !line.startsWith('*') &&
            /[\u4e00-\u9fff]/.test(line) &&
            /['"`][^'"`]*[\u4e00-\u9fff]/.test(line),
        )
      assert.deepEqual(userFacing, [], `${file} still contains a CJK string literal: ${userFacing[0] ?? ''}`)
    }
  })

  it('mainLabel interpolates params and falls back to zh', () => {
    assert.match(SRC, /replace\(/)
    assert.match(SRC, /LABELS\.zh\[key\]/)
  })
})
