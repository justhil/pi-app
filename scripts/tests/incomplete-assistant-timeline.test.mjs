import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('incomplete assistant after force-quit', () => {
  it('timeline always emits assistant entries even when text is empty', () => {
    const src = readFileSync(join(root, 'src/worker/worker-timeline.ts'), 'utf8')
    assert.match(src, /pushAssistantItem/)
    assert.match(src, /Always keep assistant/)
    assert.match(src, /extractThinking/)
    // Old bug: only push when text is truthy
    assert.doesNotMatch(
      src,
      /if \(text\) \{\s*items\.push\(\{\s*id: `hist-\$\{/,
    )
  })

  it('UI keeps empty incomplete assistants for rewind', () => {
    const src = readFileSync(join(root, 'src/renderer/src/features/timeline/timeline.tsx'), 'utf8')
    assert.match(src, /interruptedEmpty/)
    assert.match(src, /sessionEntryId \|\| isInterrupted/)
  })

  it('dispose aborts active turn before session.dispose', () => {
    const src = readFileSync(join(root, 'src/worker/handlers/worker-handlers-turn.ts'), 'utf8')
    const block = src.slice(src.indexOf('handleDispose'), src.indexOf('handlePing'))
    assert.match(block, /abort/)
    assert.match(block, /dispose/)
  })
})
