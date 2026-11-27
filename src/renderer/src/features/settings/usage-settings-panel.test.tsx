// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageLogPage, UsageRequestDetail, UsageStatsBucket, UsageSummary } from '@shared/usage-summary'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key
      return `${key}:${JSON.stringify(opts)}`
    },
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
  },
}))

import { UsageSettingsPanel } from './usage-settings-panel'

function makeStats(overrides: Partial<UsageStatsBucket> = {}): UsageStatsBucket {
  return {
    input: 1000,
    output: 500,
    cacheRead: 4000,
    cacheWrite: 500,
    cacheWrite1h: 200,
    reasoning: 150,
    cost: 0.42,
    calls: 3,
    costBreakdown: { input: 0.05, output: 0.3, cacheRead: 0.02, cacheWrite: 0.05 },
    successCalls: 2,
    errorCalls: 0,
    abortedCalls: 1,
    lengthCalls: 0,
    cacheHitRate: 4000 / 5500,
    writeCacheRate: 500 / 5500,
    durationCalls: 2,
    avgDurationMs: 4200,
    p50DurationMs: 4000,
    ttftCalls: 2,
    avgTtftMs: 950,
    p50TtftMs: 900,
    p90TtftMs: 1100,
    totalTps: 62.5,
    genTps: 88.4,
    ...overrides,
  }
}

const sampleSummary: UsageSummary = {
  from: 1_700_000_000_000,
  to: 1_700_600_000_000,
  total: makeStats(),
  cacheHitRate: 4000 / 5500,
  activeDays: 2,
  sessions: 2,
  firstAt: 1_700_000_000_000,
  byDay: [
    { day: '2026-10-05', ...makeStats({ calls: 1, cost: 0.12 }) },
    { day: '2026-10-06', ...makeStats({ calls: 2, cost: 0.3 }) },
  ],
  heat: {
    calls: new Array<number>(168).fill(0),
    cost: new Array<number>(168).fill(0),
    tokens: new Array<number>(168).fill(0),
  },
  byModel: [
    {
      model: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      modelId: 'claude-opus-4-6',
      ...makeStats(),
    },
  ],
  byProject: [{ project: 'D:/workspace/pi-app', ...makeStats() }],
  topSessions: [
    {
      sessionFile: 'C:/Users/test/.pi/agent/sessions/--proj--/s1.jsonl',
      title: 'Implement usage page',
      project: 'D:/workspace/pi-app',
      ...makeStats(),
    },
  ],
}

const sampleLogs: UsageLogPage = {
  totalCount: 270,
  offset: 0,
  limit: 50,
  facets: {
    models: ['anthropic/claude-opus-4-6'],
    projects: ['D:/workspace/pi-app'],
    apis: ['anthropic-messages'],
  },
  rows: [
    {
      id: 's1.jsonl::entry-42',
      sessionFile: 'C:/Users/test/.pi/agent/sessions/--proj--/s1.jsonl',
      entryId: 'entry-42',
      parentId: 'entry-41',
      sessionTitle: 'Implement usage page',
      project: 'D:/workspace/pi-app',
      ts: 1_700_000_010_000,
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'anthropic/claude-opus-4-6',
      modelId: 'claude-opus-4-6',
      responseModel: 'claude-opus-4-6-20260801',
      thinkingLevel: 'high',
      stopReason: 'stop',
      status: 'ok',
      input: 1000,
      output: 500,
      reasoning: 150,
      cacheRead: 4000,
      cacheWrite: 500,
      cacheWrite1h: 200,
      totalTokens: 6000,
      cacheHitRate: 4000 / 5500,
      writeCacheRate: 500 / 5500,
      cost: 0.0218,
      costBreakdown: { input: 0.002, output: 0.015, cacheRead: 0.0018, cacheWrite: 0.003 },
      durationMs: 4000,
      ttftMs: 900,
      firstTokenKind: 'thinking',
      totalTps: 62.5,
      genTps: 88.4,
    },
  ],
}

const sampleDetail: UsageRequestDetail = {
  sessionFile: 'C:/Users/test/.pi/agent/sessions/--proj--/s1.jsonl',
  sessionId: 'sess-1',
  sessionTitle: 'Implement usage page',
  project: 'D:/workspace/pi-app',
  entryId: 'entry-42',
  parentId: 'entry-41',
  model: { provider: 'anthropic', modelId: 'claude-opus-4-6' },
  thinkingLevel: 'high',
  request: {
    totalMessages: 3,
    focusStartIndex: 2,
    systemSections: [{ name: 'system', content: 'You are Pi.' }],
    toolsDeclared: { added: [{ name: 'read' }], removed: [] },
    messages: [
      {
        index: 0,
        role: 'user',
        summary: 'Old turn question',
        blocks: [{ type: 'text', text: 'Old turn question' }],
      },
      {
        index: 1,
        role: 'assistant',
        summary: 'Old turn answer',
        blocks: [{ type: 'text', text: 'Old turn answer' }],
      },
      {
        index: 2,
        role: 'user',
        summary: 'Latest trigger prompt',
        blocks: [{ type: 'text', text: 'Latest trigger prompt full body' }],
      },
    ],
    rawContextJson: { messages: [] },
  },
  response: {
    blocks: [
      { type: 'thinking', thinking: 'Deep reasoning content' },
      { type: 'text', text: 'Final assistant answer body' },
    ],
    toolResults: [],
    rawMessageJson: { id: 'entry-42' },
  },
}

describe('UsageSettingsPanel', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (method: string) => {
      if (method === 'usage.summary') return sampleSummary
      if (method === 'usage.logs') return sampleLogs
      if (method === 'usage.requestDetail') return sampleDetail
      throw new Error(`Unexpected IPC: ${method}`)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('should_render_overview_tps_ttft_cache_and_drill_down_to_model_logs_and_request_response_drawer', async () => {
    render(<UsageSettingsPanel />)

    // Overview KPIs: TPS 88.4, TTFT 900ms, Cache Hit 72.7%
    await waitFor(() => {
      expect(screen.getAllByText(/88\.4/).length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText(/72\.7%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/900ms/).length).toBeGreaterThan(0)

    // Click model row -> switches to Request Logs filtered by anthropic/claude-opus-4-6
    fireEvent.click(screen.getByText('anthropic/claude-opus-4-6'))

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        'usage.logs',
        expect.objectContaining({ model: 'anthropic/claude-opus-4-6' }),
      )
    })

    // Log row shows routed model indicator & exact cost
    await waitFor(() => {
      expect(screen.getByText(/claude-opus-4-6-20260801/)).toBeInTheDocument()
    })
    expect(screen.getByText('$0.0218')).toBeInTheDocument()

    // Click log row -> opens UsageRequestDrawer reading from local .jsonl
    fireEvent.click(screen.getByText('$0.0218'))

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('usage.requestDetail', {
        sessionFile: 'C:/Users/test/.pi/agent/sessions/--proj--/s1.jsonl',
        entryId: 'entry-42',
      })
    })

    // Current turn trigger is expanded by default; earlier 2 messages are collapsed
    await waitFor(() => {
      expect(screen.getByText('Latest trigger prompt full body')).toBeInTheDocument()
    })
    expect(screen.queryByText('Old turn question')).not.toBeInTheDocument()

    // Expand earlier context
    fireEvent.click(screen.getByText(/earlierMessagesToggle/))
    expect(screen.getByText('Old turn question')).toBeInTheDocument()

    // Switch to Response tab -> displays thinking + final response text
    fireEvent.click(screen.getByRole('tab', { name: 'settings:usage.tabResponse' }))
    expect(screen.getByText('Deep reasoning content')).toBeInTheDocument()
    expect(screen.getByText('Final assistant answer body')).toBeInTheDocument()

    // Close drawer and verify direct page jump (input page 4 + Enter -> offset = 150)
    fireEvent.click(screen.getByLabelText('settings:usage.drawerClose'))
    const jumpInput = screen.getByLabelText('settings:usage.jumpToPage')
    fireEvent.change(jumpInput, { target: { value: '4' } })
    fireEvent.keyDown(jumpInput, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        'usage.logs',
        expect.objectContaining({ offset: 150, limit: 50 }),
      )
    })
  })
})
