import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateSbom } from '../generate-release-sbom.mjs'

describe('generate-release-sbom (F-10)', () => {
  it('writes CycloneDX JSON with production components', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-sbom-'))
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 't', version: '1.0.0', dependencies: { zod: '^3.0.0' } }),
      )
      await writeFile(
        join(dir, 'package-lock.json'),
        JSON.stringify({
          name: 't',
          version: '1.0.0',
          packages: {
            '': { name: 't', version: '1.0.0' },
            'node_modules/zod': { version: '3.24.1' },
          },
        }),
      )
      const out = join(dir, 'sbom.cdx.json')
      const r = await generateSbom(dir, out)
      const bom = JSON.parse(await readFile(out, 'utf8'))
      assert.equal(bom.bomFormat, 'CycloneDX')
      assert.ok(r.componentCount >= 1)
      assert.ok(bom.components.some((c) => c.name === 'zod'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})