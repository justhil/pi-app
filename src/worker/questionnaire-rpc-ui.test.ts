import { describe, expect, it, vi } from 'vitest'
import type { EventBus, ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { createDesktopUIBridge } from './desktop-ui-bridge'
import { createQuestionnaireRpcUI } from './questionnaire-rpc-ui'

describe('questionnaire-rpc-ui & desktop-ui-bridge (pi-decide + pi-plan-mode)', () => {
  it('forwards timeout & deadlineAt to desktop ask_user_question and resolves cancelled on timeout so pi-decide autopilot takes over', async () => {
    vi.useFakeTimers()
    try {
      const emitted: unknown[] = []
      const dismissed: Array<{ id: string; reason: string }> = []
      const bus = { on: () => () => {} } as unknown as EventBus
      const bridge = createDesktopUIBridge(
        bus,
        (req) => emitted.push(req),
        (id, reason) => dismissed.push({ id, reason }),
      )

      const questions = [
        {
          question: 'Pick cache strategy?',
          header: 'Cache',
          recommended: 'LRU',
          recommendedBecause: 'Bounded memory',
          options: [
            { label: 'LRU', description: 'Evict oldest' },
            { label: 'None', description: 'Unbounded' },
          ],
        },
      ]

      const rpcUi = createQuestionnaireRpcUI(
        bridge.uiContext as unknown as ExtensionUIContext,
        'call-decide-1',
        questions,
        undefined,
        (id, rows, sig, timeoutMs) => bridge.requestQuestionnaire(id, rows, sig, timeoutMs),
      )

      const selectPromise = rpcUi.select('Pick cache strategy?', ['LRU ★ recommended', 'None'], {
        timeout: 5_000,
      })

      expect(emitted).toHaveLength(1)
      const req = emitted[0] as { id: string; timeout?: number; deadlineAt?: number }
      expect(req.timeout).toBe(5_000)
      expect(typeof req.deadlineAt).toBe('number')

      await vi.advanceTimersByTimeAsync(5_050)
      const chosen = await selectPromise
      // Returning undefined at deadline lets pi-decide's `explainUndefined()` detect `expired` -> autopilot!
      expect(chosen).toBeUndefined()
      expect(dismissed).toEqual([{ id: req.id, reason: 'timeout' }])

      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches pi-decide ★ recommended suffix and replays multi-select toggle loops until ✅ Done', async () => {
    const base = {} as unknown as ExtensionUIContext
    const questions = [
      {
        question: 'Primary database?',
        header: 'DB',
        recommended: 'SQLite',
        options: [
          { label: 'SQLite', description: 'Local file' },
          { label: 'Postgres', description: 'Server' },
        ],
      },
      {
        question: 'Which checks should run?',
        header: 'Checks',
        multiSelect: true,
        options: [
          { label: 'Typecheck', description: 'tsc' },
          { label: 'Unit tests', description: 'vitest' },
          { label: 'Lint', description: 'eslint' },
        ],
      },
    ]

    const rpcUi = createQuestionnaireRpcUI(base, 'call-2', questions, undefined, async () => ({
      cancelled: false,
      answers: [
        { questionIndex: 0, question: 'Primary database?', kind: 'option', answer: 'SQLite' },
        {
          questionIndex: 1,
          question: 'Which checks should run?',
          kind: 'multi',
          answer: null,
          selected: ['Typecheck', 'Lint'],
        },
      ],
    }))

    // Q1: single-choice with pi-decide's `★ recommended` suffix
    const q1 = await rpcUi.select('Primary database?', ['SQLite ★ recommended', 'Postgres'])
    expect(q1).toBe('SQLite ★ recommended')

    // Q2: pi-decide multi-select loop (`◻ ...` / `✅ ...` + `✅ Done`)
    const s1 = await rpcUi.select('Which checks?', ['◻ Typecheck', '◻ Unit tests', '◻ Lint', '✅ Done'])
    expect(s1).toBe('◻ Typecheck')
    const s2 = await rpcUi.select('Which checks?', ['✅ Typecheck', '◻ Unit tests', '◻ Lint', '✅ Done'])
    expect(s2).toBe('◻ Lint')
    const s3 = await rpcUi.select('Which checks?', ['✅ Typecheck', '◻ Unit tests', '✅ Lint', '✅ Done'])
    expect(s3).toBe('✅ Done')
  })

  it('supports @narumitw/pi-tui-kit RPC custom answer flow via synthetic Other row + ui.editor()', async () => {
    const base = {} as unknown as ExtensionUIContext
    const questions = [
      {
        question: 'Rollout strategy?',
        header: 'Rollout',
        options: [
          { label: 'Canary', description: 'Gradual' },
          { label: 'Big bang', description: 'All at once' },
        ],
      },
    ]

    const rpcUi = createQuestionnaireRpcUI(base, 'call-plan-1', questions, undefined, async () => ({
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: 'Rollout strategy?',
          kind: 'custom',
          answer: 'Feature-flag per workspace first',
        },
      ],
    }))

    const pickedRow = await rpcUi.select('Rollout: Rollout strategy?', [
      '1. Canary — Gradual',
      '2. Big bang — All at once',
      '3. Other (free-form)',
    ])
    expect(pickedRow).toBe('3. Other (free-form)')

    const customText = await rpcUi.editor('Rollout strategy?', '')
    expect(customText).toBe('Feature-flag per workspace first')
  })
})
