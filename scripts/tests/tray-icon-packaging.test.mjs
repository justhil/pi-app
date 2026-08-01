import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Windows tray icon packaging contract', () => {
  it('generates the icon before every package path and ships the runtime ICO location', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

    assert.match(pkg.scripts.package, /icon:export\s*&&/, 'generic package must generate app icons first')
    assert.match(pkg.scripts['package:win'], /icon:export\s*&&/, 'Windows package must generate app icons first')
    assert.match(builder, /from:\s*build\/icon\.ico[\s\S]*to:\s*resources\/build\/icon\.ico/)
    assert.ok(existsSync(join(root, 'build', 'icon.ico')), 'generated Windows ICO must exist')
  })
})
