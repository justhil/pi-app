import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Prefer built main bundle when available; otherwise transpile the TS source.
 * (electron-vite currently folds workspace-fs into out/main/index.js, so the
 * legacy out/main/workspace-fs.js path is usually missing.)
 */
async function loadResolvePathUnderWorkspace() {
  const standalone = join(process.cwd(), 'out/main/workspace-fs.js')
  if (existsSync(standalone)) {
    const mod = await import(pathToFileURL(standalone).href)
    if (typeof mod.resolvePathUnderWorkspace === 'function') return mod.resolvePathUnderWorkspace
  }

  // Source-level fallback: always available in CI without relying on chunk names.
  const sourcePath = join(process.cwd(), 'src/main/workspace-fs.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  // Evaluate CJS in isolation via Function + createRequire for node:fs/path.
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  const filename = join(tmpdir(), 'workspace-fs-contract.cjs')
  const evaluate = new Function('exports', 'require', 'module', '__filename', '__dirname', js)
  evaluate(module.exports, require, module, filename, dirname(filename))
  const resolvePathUnderWorkspace = module.exports.resolvePathUnderWorkspace
  if (typeof resolvePathUnderWorkspace !== 'function') {
    throw new Error('resolvePathUnderWorkspace export missing after transpile')
  }
  return resolvePathUnderWorkspace
}

const resolvePathUnderWorkspace = await loadResolvePathUnderWorkspace()

describe('resolvePathUnderWorkspace', () => {
  it('rejects path traversal above root', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
    const result = resolvePathUnderWorkspace(root, '../outside')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'outside_workspace')
  })

  it('allows file under root', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
    writeFileSync(join(root, 'a.txt'), 'x')
    const result = resolvePathUnderWorkspace(root, 'a.txt')
    assert.equal(result.ok, true)
  })

  it('allows nested directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
    mkdirSync(join(root, 'sub'))
    const result = resolvePathUnderWorkspace(root, 'sub')
    assert.equal(result.ok, true)
  })
})
