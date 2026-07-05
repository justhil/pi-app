import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Composer paste image guard', () => {
  it('handlePaste blocks default before html img and uses chip insert', () => {
    const hook = readFileSync(join(root, 'src/renderer/src/features/composer/use-composer-attachments.ts'), 'utf8')
    assert.match(hook, /extractDataUrlImageFromHtml/)
    assert.match(hook, /htmlImage/)
    assert.match(hook, /insertAttachmentAtCursor/)
    assert.match(hook, /e\.preventDefault\(\)/)
    const preventIdx = hook.indexOf('e.preventDefault()')
    const htmlIdx = hook.indexOf('extractDataUrlImageFromHtml')
    assert.ok(htmlIdx > 0 && preventIdx > htmlIdx)
  })
})