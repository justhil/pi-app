import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateChecksums } from '../generate-release-checksums.mjs'

describe('generate-release-checksums (F-10)', () => {
  it('writes deterministic SHA256SUMS.txt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-rel-'))
    try {
      await writeFile(join(dir, 'a.bin'), 'hello')
      await writeFile(join(dir, 'b.bin'), 'world')
      const r = await generateChecksums(dir)
      const text = await readFile(r.outputPath, 'utf8')
      assert.match(text, /^[a-f0-9]{64}  a\.bin\n[a-f0-9]{64}  b\.bin\n$/)
      assert.equal(r.count, 2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})