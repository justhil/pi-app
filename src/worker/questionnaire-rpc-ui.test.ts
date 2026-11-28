import { describe, expect, it, vi } from 'vitest'
import type { EventBus, ExtensionUIContext, LoadExtensionsResult } from '@earendil-works/pi-coding-agent'
import { createDesktopUIBridge, getDesktopUIBridge } from './desktop-ui-bridge'
import { createQuestionnaireRpcUI } from './questionnaire-rpc-ui'
import { decorateQuestionnaireTools } from './questionnaire-tool-decorator'

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

  it('resolves DesktopUIBridge even after Pi SDK runner shallow-clones uiContext via { ...ui }', async () => {
    const emitted: Array<Record<string, unknown>> = []
    const bus = { on: () => () => {} } as unknown as EventBus
    const bridge = createDesktopUIBridge(bus, (req) => emitted.push(req as Record<string, unknown>))

    // Simulate Pi SDK 1.6.1 ExtensionRunner.wrapUIPromptContext(ui) shallow clone:
    const wrappedUi = {
      ...bridge.uiContext,
      select: (title: string, options: string[], opts?: { timeout?: number }) =>
        (bridge.uiContext.select as (t: string, o: string[], op?: { timeout?: number }) => Promise<string | undefined>)(
          title,
          options,
          opts,
        ),
    }

    expect(wrappedUi).not.toBe(bridge.uiContext)
    expect(getDesktopUIBridge(wrappedUi)).toBe(bridge)

    // Verify decorateQuestionnaireTools intercepts pi-decide's ask_user_question into ask_user_question (NOT raw select)
    const rawToolExecute = vi.fn(async (_id, _params, _sig, _upd, ctx: { ui: ExtensionUIContext }) => {
      const picked = await ctx.ui.select('Native fallback title', ['Option A ★ recommended', 'Option B'], {
        timeout: 180_000,
      })
      return { content: [{ type: 'text', text: picked ?? 'none' }], details: {} }
    })

    const fakeResult = {
      extensions: [
        {
          path: 'C:\\Users\\Admin\\.pi\\agent\\npm\\node_modules\\pi-decide\\src\\extension.ts',
          resolvedPath: 'C:\\Users\\Admin\\.pi\\agent\\npm\\node_modules\\pi-decide\\src\\extension.ts',
          sourceInfo: { source: 'local' },
          tools: new Map([
            [
              'ask_user_question',
              {
                definition: {
                  name: 'ask_user_question',
                  execute: rawToolExecute,
                },
              },
            ],
          ]),
        },
      ],
      errors: [],
      runtime: {} as never,
    } as unknown as LoadExtensionsResult

    const decorated = decorateQuestionnaireTools(fakeResult, process.cwd())
    const tool = decorated.extensions[0].tools.get('ask_user_question')!

    const runPromise = tool.definition.execute(
      'call-live-1',
      {
        questions: [
          {
            header: 'Layout',
            question: 'Preferred layout?',
            recommended: 'Option A',
            options: [
              { label: 'Option A', description: 'Inline' },
              { label: 'Option B', description: 'Modal' },
            ],
          },
        ],
      },
      undefined,
      undefined,
      { ui: wrappedUi } as never,
    )

    // Must emit custom `ask_user_question` with timeout + deadlineAt, NEVER raw `select`!
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      method: 'custom',
      kind: 'ask_user_question',
      toolCallId: 'call-live-1',
      timeout: 180_000,
    })
    expect(typeof emitted[0].deadlineAt).toBe('number')

    bridge.handleExtensionUIResponse({
      id: String(emitted[0].id),
      result: {
        cancelled: false,
        answers: [{ questionIndex: 0, question: 'Preferred layout?', kind: 'option', answer: 'Option A' }],
      },
    })

    const res = await runPromise
    expect((res.content[0] as { text: string }).text).toBe('Option A ★ recommended')

    bridge.dispose()
    expect(getDesktopUIBridge(wrappedUi)).toBeNull()
  })

  it('supports rpiv-ask-user-question "Type something." sentinel + pi-ask-user-questions free-text batch input', async () => {
    const bus = { on: () => () => {} } as unknown as EventBus
    const base = createDesktopUIBridge(bus, () => {}).uiContext as unknown as ExtensionUIContext
    // 1. rpiv-ask-user-question single-select custom answer ("3. Type something." -> ui.input)
    const rpivUi = createQuestionnaireRpcUI(
      base,
      'rpiv-call-1',
      [
        {
          question: 'Pick DB?',
          options: [{ label: 'SQLite (Recommended)' }, { label: 'Postgres' }],
        },
      ],
      undefined,
      async () => ({
        cancelled: false,
        answers: [{ questionIndex: 0, question: 'Pick DB?', kind: 'custom', answer: 'DuckDB' }],
      }),
    )
    const sentinel = await rpivUi.select('Pick DB?', [
      '1. SQLite (Recommended) — local',
      '2. Postgres — server',
      '3. Type something.',
    ])
    expect(sentinel).toBe('3. Type something.')
    const typed = await rpivUi.input('Type your answer:', '')
    expect(typed).toBe('DuckDB')

    // 2. pi-ask-user-questions batch free-text (`options: []`, sequential ui.input calls)
    const freeTextUi = createQuestionnaireRpcUI(
      base,
      'ask-user-1',
      [
        { question: 'What should I call you?', description: 'used in greeting', options: [] },
        { question: 'What are we building?', options: [] },
      ],
      undefined,
      async (_id, _qs, _sig, timeoutMs) => {
        expect(timeoutMs).toBe(120_000)
        return {
          cancelled: false,
          answers: [
            { questionIndex: 0, question: 'What should I call you?', kind: 'custom', answer: 'Hil' },
            { questionIndex: 1, question: 'What are we building?', kind: 'custom', answer: 'pi-Desktop' },
          ],
        }
      },
    )
    expect(await freeTextUi.input('Question 1 of 2', undefined, { timeout: 120_000 })).toBe('Hil')
    expect(await freeTextUi.input('Question 2 of 2', undefined)).toBe('pi-Desktop')
  })
})
