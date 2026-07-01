import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const modPath = join(process.cwd(), 'out/main/workspace-fs.js')
if (!existsSync(modPath)) {
  describe('resolvePathUnderWorkspace', () => {
    it('skipped — run npm run build first', { skip: true }, () => {})
  })
} else {
  const { resolvePathUnderWorkspace } = await import(modPath)

  describe('resolvePathUnderWorkspace', () => {
    it('rejects path traversal above root', () => {
      const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
      const r = resolvePathUnderWorkspace(root, '../outside')
      assert.equal(r.ok, false)
      if (!r.ok) assert.equal(r.error, 'outside_workspace')
    })

    it('allows file under root', () => {
      const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
      writeFileSync(join(root, 'a.txt'), 'x')
      const r = resolvePathUnderWorkspace(root, 'a.txt')
      assert.equal(r.ok, true)
    })

    it('allows nested directory', () => {
      const root = mkdtempSync(join(tmpdir(), 'pi-ws-'))
      mkdirSync(join(root, 'sub'))
      const r = resolvePathUnderWorkspace(root, 'sub')
      assert.equal(r.ok, true)
    })
  })
}