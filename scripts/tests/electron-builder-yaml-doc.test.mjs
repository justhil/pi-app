/**
 * Regression: electron-builder must not strip yaml package runtime files.
 * yaml@2 require()s ../doc/directives.js from dist/compose/composer.js.
 * A broad blanket exclude of every "doc" directory caused session.list to fail
 * after install (GitHub issue 21).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('electron-builder packaging safety (yaml runtime doc)', () => {
  it('does not use a blanket !**/doc/** exclude that removes yaml/dist/doc', () => {
    const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    // Only match real files: list entries (not comments explaining the ban).
    const listEntryBlanketDoc = /^\s*-\s*['"]!\*\*\/doc\/\*\*['"]\s*$/m
    const listEntryDocDir = /^\s*-\s*['"]!\*\*\/doc['"]\s*$/m
    assert.equal(
      listEntryBlanketDoc.test(yml),
      false,
      'electron-builder.yml files: must not list !**/doc/** (strips yaml/dist/doc; issue 21)',
    )
    assert.equal(
      listEntryDocDir.test(yml),
      false,
      'electron-builder.yml files: must not list !**/doc',
    )
    // Still exclude documentation trees under docs/
    assert.match(yml, /^\s*-\s*['"]!\*\*\/docs\/\*\*['"]/m, 'should still exclude **/docs/** for size')
  })

  it('documents the yaml runtime path that must ship in asar', () => {
    // Prefer nested yaml from pi-coding-agent when hoisted copy is absent
    const candidates = [
      join(root, 'node_modules/yaml/dist/doc/directives.js'),
      join(
        root,
        'node_modules/@earendil-works/pi-coding-agent/node_modules/yaml/dist/doc/directives.js',
      ),
    ]
    const found = candidates.find((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    })
    assert.ok(
      found,
      'yaml dist/doc/directives.js must exist in node_modules (install dependencies first)',
    )
  })
})
