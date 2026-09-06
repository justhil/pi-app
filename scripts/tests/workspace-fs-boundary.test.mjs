import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
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
  function evaluateSource(filename) {
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const nativeRequire = createRequire(pathToFileURL(filename))
    const require = (id) => id.startsWith('.')
      ? evaluateSource(resolve(dirname(filename), `${id}.ts`))
      : nativeRequire(id)
    const module = { exports: {} }
    const evaluate = new Function('exports', 'require', 'module', '__filename', '__dirname', js)
    evaluate(module.exports, require, module, filename, dirname(filename))
    return module.exports
  }
  const resolvePathUnderWorkspace = evaluateSource(sourcePath).resolvePathUnderWorkspace
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
