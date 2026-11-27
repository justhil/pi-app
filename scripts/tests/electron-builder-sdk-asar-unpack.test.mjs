import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import beforePack from '../before-pack.mjs'
import { collectPiSdkClosurePackages } from '../lib/pi-sdk-asar-unpack.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('electron-builder Pi SDK asarUnpack closure (#140)', () => {
  it('wires ./scripts/before-pack.mjs in electron-builder.yml', () => {
    const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    assert.match(yml, /^beforePack:\s*\.\/scripts\/before-pack\.mjs\s*$/m)
  })

  it('collects critical SDK and peer runtime packages while excluding UI-only dependencies', () => {
    const pkgs = new Set(collectPiSdkClosurePackages(root))

    for (const required of [
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-tui',
      '@earendil-works/chord',
      'typebox',
      'yaml',
      'jiti',
      'undici',
      'zod',
      '@silvia-odwyer/photon-node',
    ]) {
      assert.ok(pkgs.has(required), `Expected ${required} in Pi SDK asarUnpack closure`)
    }

    assert.ok(
      Array.from(pkgs).some((name) => name.startsWith('@esbuild/')),
      'Expected @esbuild/* platform packages in Pi SDK asarUnpack closure',
    )

    for (const uiOnly of ['react', 'mermaid', 'lucide-react']) {
      assert.equal(pkgs.has(uiOnly), false, `Did not expect UI-only package ${uiOnly} in SDK closure`)
    }
  })

  it('merges asarUnpack patterns idempotently across multi-arch beforePack calls', async () => {
    const context = {
      packager: {
        projectDir: root,
        config: {
          asarUnpack: ['**/node_modules/@lydell/node-pty*/**'],
        },
      },
    }

    await beforePack(context)
    const first = [...context.packager.config.asarUnpack]
    assert.ok(first.includes('**/node_modules/@lydell/node-pty*/**'))
    assert.ok(first.includes('**/node_modules/typebox/**'))
    assert.ok(first.includes('**/node_modules/@earendil-works/pi-coding-agent/**'))

    await beforePack(context)
    const second = [...context.packager.config.asarUnpack]
    assert.equal(second.length, first.length, 'beforePack must be idempotent across x64/arm64 invocations')
    assert.deepEqual(second, first)
  })
})
