import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker pool session routing (Phase 1)', () => {
  it('should_export_session_key_and_pool_config_helpers', () => {
    const keySrc = readFileSync(join(root, 'src/main/worker-session-key.ts'), 'utf8')
    const cfgSrc = readFileSync(join(root, 'src/main/worker-pool-config.ts'), 'utf8')
    assert.match(keySrc, /export function normalizeSessionKey/)
    assert.match(keySrc, /export function workspacePoolKey/)
    assert.match(cfgSrc, /export function minutesToIdleDelayMs/)
    assert.match(cfgSrc, /MAX_TIMER_DELAY_MS/)
    assert.match(cfgSrc, /normalizeMaxSessionWorkers/)
  })

  it('should_route_prompt_by_sessionFile', () => {
    const prompt = readFileSync(join(root, 'src/main/ipc/handlers/prompt.ts'), 'utf8')
    assert.match(prompt, /sendPrompt\(req\.text,\s*req\.sessionFile\)/)
    assert.match(prompt, /steer\(req\.text,\s*req\.sessionFile\)/)
    assert.match(prompt, /abort\(sessionFile\)/)
  })

  it('should_use_poolKey_on_worker_slots', () => {
    const types = readFileSync(join(root, 'src/main/worker-manager-types.ts'), 'utf8')
    const mgr = readFileSync(join(root, 'src/main/worker-manager.ts'), 'utf8')
    assert.match(types, /poolKey:\s*string/)
    assert.match(types, /lastIdleAt/)
    assert.match(mgr, /ensureSessionWorker/)
    assert.match(mgr, /listSessionRuntime/)
  })

  it('should_persist_maxSessionWorkers_in_config_store', () => {
    const store = readFileSync(join(root, 'src/main/config-store.ts'), 'utf8')
    assert.match(store, /maxSessionWorkers/)
    assert.match(store, /sessionWorkerIdleTimeoutMinutes/)
    assert.match(store, /alertOnBackgroundRunIdle/)
  })
})
