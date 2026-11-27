import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  agentDir: '',
  usageSummary: vi.fn(),
  usageLogs: vi.fn(),
  usageRequestDetail: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, fn: (req: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, fn)
  },
}))
vi.mock('../../agent-dir', () => ({
  resolveActiveAgentDir: () => mocks.agentDir,
}))
vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: {
    usageSummary: (...args: unknown[]) => mocks.usageSummary(...args),
    usageLogs: (...args: unknown[]) => mocks.usageLogs(...args),
    usageRequestDetail: (...args: unknown[]) => mocks.usageRequestDetail(...args),
  },
}))
vi.mock('../../wsl/wsl-env', () => ({
  awaitWslVm: vi.fn(async () => {}),
}))

import { registerUsageHandlers } from './usage'

describe('usage IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.usageSummary.mockReset()
    mocks.usageLogs.mockReset()
    mocks.usageRequestDetail.mockReset()
    const dir = mkdtempSync(join(tmpdir(), 'pi-usage-ipc-'))
    mkdirSync(join(dir, 'sessions', '--proj--'), { recursive: true })
    mocks.agentDir = dir
    registerUsageHandlers()
  })

  it('should_forward_usage_logs_with_computed_day_window', async () => {
    mocks.usageLogs.mockResolvedValue({ totalCount: 0, offset: 0, limit: 50, rows: [], facets: { models: [], projects: [], apis: [] } })
    const handler = mocks.handlers.get('ipc:usage.logs')!
    await handler({ days: 7, model: 'anthropic/claude-opus-4-6', status: 'ok', offset: 0, limit: 50 })

    expect(mocks.usageLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: mocks.agentDir,
        model: 'anthropic/claude-opus-4-6',
        status: 'ok',
        offset: 0,
        limit: 50,
      }),
    )
  })

  it('should_authorize_sessionFile_inside_session_roots_and_reject_outside_files', async () => {
    const allowed = join(mocks.agentDir, 'sessions', '--proj--', 'valid.jsonl')
    writeFileSync(allowed, '{}\n')
    mocks.usageRequestDetail.mockResolvedValue({ entryId: 'e1' })

    const handler = mocks.handlers.get('ipc:usage.requestDetail')!
    const okRes = await handler({ sessionFile: allowed, entryId: 'e1' })
    expect(okRes).toEqual({ entryId: 'e1' })

    const outside = join(tmpdir(), 'secret-outside.jsonl')
    writeFileSync(outside, '{}\n')
    await expect(handler({ sessionFile: outside, entryId: 'e1' })).rejects.toThrow(/untrusted_session_file/)
  })
})
