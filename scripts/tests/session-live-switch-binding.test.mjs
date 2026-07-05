import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
/** Normalize CRLF so regex contracts match on Windows CI checkouts. */
const src = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

describe('live session switch binding', () => {
  it('clears stale pendingBind when restoring a worker-bound live session from cache', () => {
    const text = src('src/renderer/src/lib/open-session.ts')
    const liveRestore = text.match(/if \(live && liveTurnActive\) \{[\s\S]*?return\r?\n\s*\}/)?.[0] ?? ''
    assert.ok(liveRestore.length > 0, 'live restore block not found in open-session.ts')
    assert.match(liveRestore, /session\.setPendingBind[\s\S]*sessionFile:\s*null/)
    assert.match(liveRestore, /refreshSessionTree\(sessionFile\)/)
  })

  it('sends the visible sessionFile with prompt and queue requests', () => {
    const text = src('src/renderer/src/features/composer/use-composer-send.ts')
    assert.match(text, /sessionFile:\s*useUIStore\.getState\(\)\.historySessionFile\s*\?\?\s*undefined/)
    assert.match(text, /prompt\.send[\s\S]*promptPayload\(\)/)
    assert.match(text, /prompt\.steer[\s\S]*promptPayload\(\)/)
    assert.match(text, /prompt\.followUp[\s\S]*promptPayload\(\)/)
  })

  it('scopes abort and queue restoration to the visible sessionFile', () => {
    const abort = src('src/renderer/src/lib/composer-abort.ts')
    assert.match(abort, /sessionFile\s*=\s*store\.historySessionFile/)
    assert.match(abort, /prompt\.abort[\s\S]*sessionFile:\s*sessionFile\s*\?\?\s*undefined/)

    const restore = src('src/renderer/src/lib/composer-queue-restore.ts')
    assert.match(restore, /sessionFile\s*=\s*useUIStore\.getState\(\)\.historySessionFile/)
    assert.match(restore, /prompt\.dequeueClearQueue[\s\S]*sessionFile:\s*sessionFile\s*\?\?\s*undefined/)

    const main = src('src/main/ipc/handlers/prompt.ts')
    assert.match(main, /workerMatchesSession/)
    assert.match(main, /prompt\.abort[\s\S]*workerMatchesSession\(req\?\.sessionFile/)
    assert.match(main, /prompt\.dequeueClearQueue[\s\S]*workerMatchesSession\(req\?\.sessionFile/)
  })

  it('navigates the tree for the visible sessionFile, not a stale pendingBind', () => {
    const renderer = src('src/renderer/src/lib/session-rewind.ts')
    assert.match(renderer, /session\.navigateTree[\s\S]*sessionFile:\s*file/)

    const main = src('src/main/ipc/handlers/session.ts')
    assert.match(main, /ensureWorkerSessionBound\([\s\S]*sessionFile:\s*req\.sessionFile/)
  })

  it('session.tree ignores pendingBind fallback and marks workerBound only for the matching file', () => {
    const text = src('src/main/ipc/handlers/session.ts')
    const treeHandler = text.match(/registerHandler\('ipc:session\.tree'[\s\S]*?registerHandlerWithSchema\('ipc:session\.navigateTree'/)?.[0] ?? ''
    assert.doesNotMatch(treeHandler, /getPendingWorkerSessionFile\(\)/)
    assert.match(treeHandler, /workerBound:\s*workerSessionFile\s*===\s*sessionFile/)
  })
})
