/**
 * Release notes must be user-readable (in-app update dialog), not link placeholders.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseNotesFromChangelog } from '../generate-release-notes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('generate-release-notes', () => {
  it('builds notes from CHANGELOG section and strips meta link lines', () => {
    const changelog = `# Changelog

## [0.4.99] — 2026-07-12

### 新增

- 软件内更新提醒与一键升级

### 修复

- 打包不再误删 yaml 运行时文件

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://example.com/CHANGELOG.md)

## [0.4.98] — 2026-07-01

- old
`

    const notes = buildReleaseNotesFromChangelog(changelog, '0.4.99')
    assert.match(notes, /pi Desktop v0\.4\.99/)
    assert.match(notes, /软件内更新提醒/)
    assert.match(notes, /yaml 运行时/)
    assert.doesNotMatch(notes, /GitHub Release 正文链接/)
    assert.doesNotMatch(notes, /example\.com\/CHANGELOG/)
  })

  it('fails when version section is missing', () => {
    assert.throws(
      () => buildReleaseNotesFromChangelog('## [1.0.0]\n\n- x\n', '9.9.9'),
      /No CHANGELOG section/,
    )
  })

  it('release workflow injects body_path instead of changelog link placeholder', () => {
    const yml = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    assert.match(yml, /generate-release-notes\.mjs/)
    assert.match(yml, /body_path:\s*release-body\.md/)
    assert.doesNotMatch(
      yml,
      /完整更新日志：\*\*\[CHANGELOG\.md\]/,
      'must not use old link-only Release body template',
    )
  })
})
