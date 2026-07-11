import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
/** Normalize CRLF so regex contracts match on Windows CI checkouts. */
const src = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')

describe('incomplete assistant after force-quit', () => {
  it('timeline always emits assistant entries even when text is empty', () => {
    const text = src('src/worker/worker-timeline.ts')
    assert.match(text, /pushAssistantItem/)
    assert.match(text, /Always keep assistant/)
    assert.match(text, /extractThinking/)
    // Old bug: only push assistant when text is truthy (must not reappear for assistant role).
    assert.doesNotMatch(
      text,
      /role === 'assistant'[\s\S]{0,240}if \(text\) \{\s*items\.push\(\{\s*id: `hist-\$\{/,
    )
    assert.match(text, /pushAssistantItem\(items,\s*\{/)
  })

  it('UI keeps empty incomplete assistants for rewind', () => {
    const text = src('src/renderer/src/features/timeline/timeline.tsx')
    assert.match(text, /interruptedEmpty/)
    assert.match(text, /isInterruptedAssistantRow/)
    // Only true incomplete leaves show interrupted chrome (not tool-bridge empties)
    assert.match(text, /Only show interrupted chrome for true incomplete/)
  })

  it('dispose aborts active turn before session.dispose', () => {
    const text = src('src/worker/handlers/worker-handlers-turn.ts')
    const disposeIndex = text.indexOf('export async function handleDispose')
    const pingIndex = text.indexOf('export async function handlePing')
    assert.ok(disposeIndex >= 0 && pingIndex > disposeIndex, 'handleDispose/handlePing order')
    const block = text.slice(disposeIndex, pingIndex)
    assert.match(block, /abort/)
    assert.match(block, /dispose/)
  })
})
