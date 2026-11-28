// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_ADAPTERS } from '@extension-compat/builtin-adapters'
import { resolveAdapterText } from '@extension-compat/adapter-schema'
import { parseAdapterDeclaration } from '@extension-compat/adapter-validation'
import { QuestionnaireCountdownBadge } from '@renderer/features/extension-ui/questionnaire-countdown-badge'
import { ComposerInlineQuestionnaire } from '@renderer/features/extension-ui/composer-inline-questionnaire'
import { QuestionnaireDialog } from '@renderer/features/extension-ui/questionnaire-dialog'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { clearDrafts } from '@renderer/features/extension-ui/questionnaire-model'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { normalizeMessages, timelineItemsFromBranchPath } from '@worker/worker-timeline'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn(async () => ({})),
  },
}))

describe('newly installed local plugin adapters & desktop UI primitives', () => {
  it('validates pi-decide, pi-plan-mode, pi-goal, pi-quality, rpiv-ask-user-question & pi-ask-user-questions adapters cleanly', () => {
    for (const id of [
      'pi-decide',
      'pi-plan-mode',
      'pi-goal',
      'pi-quality',
      '@juicesharp/rpiv-ask-user-question',
      'pi-ask-user-questions',
    ]) {
      const found = BUILTIN_ADAPTERS.find((item) => item.id === id)
      expect(found, `missing builtin adapter ${id}`).toBeDefined()
      const parsed = parseAdapterDeclaration(found)
      expect('adapter' in parsed, `validation failed for ${id}: ${'error' in parsed ? parsed.error : ''}`).toBe(true)
      expect(found?.i18n?.zh).toBeDefined()
      expect(found?.i18n?.en).toBeDefined()
      expect(found?.i18n?.ru).toBeDefined()
      expect(found?.i18n?.ja).toBeDefined()
    }

    const goal = BUILTIN_ADAPTERS.find((item) => item.id === 'pi-goal')!
    expect(goal.match.tools).toEqual(expect.arrayContaining(['goal_complete', 'goal_blocked', 'goal_wait']))
    expect(goal.statusBar?.statusKeys).toContain('goal')

    const plan = BUILTIN_ADAPTERS.find((item) => item.id === 'pi-plan-mode')!
    expect(plan.interact?.trigger.tool).toBe('plan_mode_question')
    expect(plan.statusBar?.statusKeys).toContain('plan-mode')
    const localizedPlan = resolveAdapterText(plan, 'ja-JP')
    expect(localizedPlan.sections[0]?.title).toBe('計画・実装の既定値')
    expect(localizedPlan.sections[0]?.fields[0]?.label).toBe('計画時の思考レベル')
    expect(localizedPlan.statusBar.title).toBe('プランモード')

    const quality = BUILTIN_ADAPTERS.find((item) => item.id === 'pi-quality')!
    const gateField = quality.config?.sections?.[0]?.fields?.find((f) => f.key === 'gate')
    expect(gateField?.type).toBe('select')
    expect(gateField?.options).toEqual(['goal', 'on', 'off'])
  })

  it('renders live countdown ticking & recommended badge inside QuestionnaireDialog', () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-11-28T10:00:00Z').getTime()
      vi.setSystemTime(now)
      render(
        <QuestionnaireDialog
          requestId="req-decide-countdown"
          deadlineAt={now + 20_000}
          timeoutMs={20_000}
          questions={[
            {
              header: 'Database',
              question: 'Which store should we use?',
              recommended: 'SQLite',
              recommendedBecause: 'Zero external service dependency',
              options: [
                { label: 'SQLite', description: 'Embedded file DB' },
                { label: 'Postgres', description: 'Networked DB' },
              ],
            },
          ]}
          onSubmit={() => {}}
          onSuspend={() => {}}
          onCancel={() => {}}
        />,
      )

      const badge = screen.getByTestId('questionnaire-countdown-badge')
      expect(badge).toHaveTextContent('20s')
      expect(badge).not.toHaveAttribute('data-urgent')
      expect(screen.getByText('Zero external service dependency')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(8_000)
      })
      expect(screen.getByTestId('questionnaire-countdown-badge')).toHaveTextContent('12s')
      expect(screen.getByTestId('questionnaire-countdown-badge')).toHaveAttribute('data-urgent', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('formats multi-minute countdowns cleanly in compact mode', () => {
    const deadlineAt = Date.now() + 125_000
    render(<QuestionnaireCountdownBadge deadlineAt={deadlineAt} timeoutMs={180_000} compact />)
    expect(screen.getByTestId('questionnaire-countdown-badge')).toHaveTextContent('2:05')
  })

  it('renders EditorDialog for ctx.ui.editor requests', () => {
    useExtensionUIStore.setState({
      activePending: {
        id: 'ed-1',
        method: 'editor',
        title: 'Write custom plan note',
        prefill: 'Initial draft text',
      },
      pendingQueue: [],
      suspended: null,
    })
    render(<ExtensionUIHost />)
    expect(screen.getByText('Write custom plan note')).toBeInTheDocument()
    const area = screen.getByDisplayValue('Initial draft text') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'Updated plan note' } })
    expect(area.value).toBe('Updated plan note')
    useExtensionUIStore.getState().clearAllDialogs()
  })

  it('surfaces display:true custom messages (e.g. /plan show proposed-plan) while hiding internal contracts', () => {
    const items = timelineItemsFromBranchPath([
      {
        id: 'e1',
        type: 'custom_message',
        customType: 'plan-mode-contract',
        content: 'INTERNAL CONTRACT',
        display: false,
      },
      {
        id: 'e2',
        type: 'custom_message',
        customType: 'proposed-plan',
        content: '**Proposed Plan**\n\n1. Step one',
        display: true,
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'assistant-message',
      text: '**Proposed Plan**\n\n1. Step one',
      sessionEntryId: 'e2',
    })

    const norm = normalizeMessages([
      { role: 'custom', content: 'hidden', display: false } as never,
      { role: 'custom', content: '**Saved Plan**\n\nShip it', display: true } as never,
    ])
    expect(norm).toHaveLength(1)
    expect(norm[0].text).toBe('**Saved Plan**\n\nShip it')
  })

  it('toggles questionnaire cleanly between inline card and expanded modal while preserving tab & recommended suffix badges', () => {
    clearDrafts('ask-toggle-1')
    useExtensionUIStore.setState({
      activePending: {
        id: 'ask-toggle-1',
        method: 'ask_user_question',
        timeoutMs: 180_000,
        deadlineAt: Date.now() + 179_000,
        questions: [
          {
            header: '存储选型',
            question: '会话存储使用哪种数据库？',
            options: [
              { label: 'SQLite (Recommended)', description: '本地单文件零配置', preview: '```sql\nPRAGMA journal_mode=WAL;\n```' },
              { label: 'PostgreSQL', description: '远程多租户共享' },
            ],
          },
          {
            header: '补充说明',
            question: '请一句话描述你的迁移窗口：',
            description: '例如凌晨低峰期',
            options: [],
          },
        ],
      },
      pendingQueue: [],
      suspended: null,
      inlineHostMounted: false,
      inlineQuestionnaireExpandedModal: false,
    })

    render(
      <>
        <ComposerInlineQuestionnaire />
        <ExtensionUIHost />
      </>,
    )

    // Starts docked inline above Composer (no modal dialog yet)
    expect(screen.queryByRole('dialog')).toBeNull()
    // `(Recommended)` suffix is stripped visually and shown as the brand badge
    expect(screen.getByText('SQLite')).toBeInTheDocument()
    expect(screen.queryByText('SQLite (Recommended)')).toBeNull()
    expect(screen.getByText(/推荐|Recommended|Рекомендуется/)).toBeInTheDocument()

    // Switch to Q2 (free-text question with options: []) in the inline card and type draft
    fireEvent.click(screen.getByRole('button', { name: /补充说明/ }))
    expect(screen.getByText('例如凌晨低峰期')).toBeInTheDocument()
    const inlineArea = screen.getByPlaceholderText(/输入你的答案|Type your answer|Введите ответ/)
    fireEvent.change(inlineArea, { target: { value: '周日凌晨 02:00' } })

    // Expand to modal dialog
    fireEvent.click(screen.getByLabelText(/放大为弹窗|Expand to dialog|Развернуть в окно/))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('周日凌晨 02:00')).toBeInTheDocument()

    // Click "收起至卡片 / Dock" button in modal header -> docks back to inline card on Q2 with draft intact!
    fireEvent.click(screen.getByLabelText(/收起回内联卡片|Collapse to inline card|Свернуть в карточку/))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByDisplayValue('周日凌晨 02:00')).toBeInTheDocument()

    // Expand again and press Escape -> also docks back to inline card instead of stranding in modal
    fireEvent.click(screen.getByLabelText(/放大为弹窗|Expand to dialog|Развернуть в окно/))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByDisplayValue('周日凌晨 02:00')).toBeInTheDocument()
    useExtensionUIStore.getState().clearAllDialogs()
  })
})
