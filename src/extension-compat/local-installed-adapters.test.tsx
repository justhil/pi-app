// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_ADAPTERS } from '@extension-compat/builtin-adapters'
import { parseAdapterDeclaration } from '@extension-compat/adapter-validation'
import { QuestionnaireCountdownBadge } from '@renderer/features/extension-ui/questionnaire-countdown-badge'
import { QuestionnaireDialog } from '@renderer/features/extension-ui/questionnaire-dialog'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { normalizeMessages, timelineItemsFromBranchPath } from '@worker/worker-timeline'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn(async () => ({})),
  },
}))

describe('newly installed local plugin adapters & desktop UI primitives', () => {
  it('validates pi-decide, pi-plan-mode, pi-goal, and pi-quality builtin adapters cleanly with en/zh/ru i18n', () => {
    for (const id of ['pi-decide', 'pi-plan-mode', 'pi-goal', 'pi-quality']) {
      const found = BUILTIN_ADAPTERS.find((item) => item.id === id)
      expect(found, `missing builtin adapter ${id}`).toBeDefined()
      const parsed = parseAdapterDeclaration(found)
      expect('adapter' in parsed, `validation failed for ${id}: ${'error' in parsed ? parsed.error : ''}`).toBe(true)
      expect(found?.i18n?.zh).toBeDefined()
      expect(found?.i18n?.en).toBeDefined()
      expect(found?.i18n?.ru).toBeDefined()
    }

    const goal = BUILTIN_ADAPTERS.find((item) => item.id === 'pi-goal')!
    expect(goal.match.tools).toEqual(expect.arrayContaining(['goal_complete', 'goal_blocked', 'goal_wait']))
    expect(goal.statusBar?.statusKeys).toContain('goal')

    const plan = BUILTIN_ADAPTERS.find((item) => item.id === 'pi-plan-mode')!
    expect(plan.interact?.trigger.tool).toBe('plan_mode_question')
    expect(plan.statusBar?.statusKeys).toContain('plan-mode')

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
})
