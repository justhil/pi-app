// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PURGE_STRATEGY, defaultAgentPurgeConfig } from '@shared/agent-purge'
import {
  commitPurgedSessionAfterSend,
  consumeDraftPurgeForFirstSend,
  useAgentPurgeStore,
} from '@renderer/lib/agent-purge-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerPurgeToggle } from './composer-purge-toggle'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? String(opts.defaultValue) : key,
    i18n: { language: 'zh-CN' },
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: invokeMock },
  onAppEvent: () => () => {},
}))

describe('ComposerPurgeToggle state machine, cache impact reminders, and cipher drift warning', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    const cfg = defaultAgentPurgeConfig()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'purge.getState') {
        return { config: cfg, purgedSessions: {}, localDir: '/tmp/personas' }
      }
      return { ok: true }
    })
    useAgentPurgeStore.setState({
      loaded: true,
      config: cfg,
      purgedSessions: {},
      localDir: '/tmp/personas',
      draftContextKey: 'new-chat',
      draftEnabled: false,
      draftPersonaId: null,
      draftMode: null,
      draftStrategy: null,
      pendingLock: null,
    })
    useUIStore.setState({
      historySessionFile: null,
      timelineItems: [],
      optimisticPendingUserText: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('starts OFF on a brand-new chat, opens menu on button click without auto-enabling, commits on first send, and resets on another draft', async () => {
    const { rerender } = render(<ComposerPurgeToggle draftContextKey="new-chat" running={false} />)

    const btn = screen.getByTestId('composer-purge-toggle')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn).toHaveAttribute('data-purge-state', 'draft-off')

    // Clicking the persona icon/button opens the popover instead of silently applying a default preset
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(btn).toHaveAttribute('data-purge-state', 'draft-off')

    // Enable via the explicit header switch inside the popover
    fireEvent.click(screen.getByTestId('composer-purge-enable-switch'))
    expect(btn).toHaveAttribute('data-purge-state', 'draft-on')

    let sendPayload: ReturnType<typeof consumeDraftPurgeForFirstSend>
    act(() => {
      sendPayload = consumeDraftPurgeForFirstSend(true)
      useUIStore.setState({
        historySessionFile: '/sessions/chat-1.jsonl',
        timelineItems: [{ id: 'u1', type: 'user-message', text: 'hello', timestamp: 1 } as never],
      })
      commitPurgedSessionAfterSend('/sessions/chat-1.jsonl')
    })

    expect(sendPayload).toEqual({
      enabled: true,
      personaId: 'konata',
      mode: 'replace',
      strategy: DEFAULT_PURGE_STRATEGY,
    })

    rerender(<ComposerPurgeToggle draftContextKey="session:/sessions/chat-1.jsonl" running={false} />)
    const midBtn = screen.getByTestId('composer-purge-toggle')
    expect(midBtn).toHaveAttribute('data-purge-state', 'active-mid')

    // Re-open popover and toggle off mid-session -> shows explicit cache-impact confirmation
    fireEvent.click(midBtn)
    fireEvent.click(screen.getByTestId('composer-purge-enable-switch'))
    expect(screen.getByTestId('purge-mid-session-confirm')).toHaveTextContent(
      'composer:purge.impactReasons.toggle_disable',
    )
    fireEvent.click(screen.getByTestId('purge-mid-session-apply'))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'purge.setSession',
        expect.objectContaining({ sessionFile: '/sessions/chat-1.jsonl', enabled: false }),
      )
    })

    // Entering another brand-new draft resets draft switch to OFF
    act(() => {
      useUIStore.setState({ historySessionFile: null, timelineItems: [] })
    })
    rerender(<ComposerPurgeToggle draftContextKey="draft-2" running={false} />)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('data-purge-state', 'draft-off')
  })

  it('allows unrestricted switching before the first message and warns against keyword substitution drift', async () => {
    render(<ComposerPurgeToggle draftContextKey="new-chat" running={false} />)

    fireEvent.click(screen.getByLabelText('composer:purge.choosePersona'))
    expect(screen.getByText('composer:purge.firstTurnFreeBadge')).toBeInTheDocument()

    // Switch directly to Tool Tunnel preset -> applies immediately without mid-session confirmation
    fireEvent.click(screen.getByText('composer:purge.presets.tunnel'))
    expect(screen.queryByTestId('purge-mid-session-confirm')).not.toBeInTheDocument()
    expect(useAgentPurgeStore.getState().draftStrategy?.historyMode).toBe('tunnel')

    // Open advanced options and select minimal keyword substitution -> shows drift warning
    fireEvent.click(screen.getByText('composer:purge.showAdvanced'))
    expect(screen.getByText('composer:purge.badges.notRecommendedDrift')).toBeInTheDocument()
    fireEvent.click(screen.getByText('composer:purge.cipherLevels.minimal'))
    expect(screen.getByTestId('purge-cipher-drift-warning')).toHaveTextContent(
      'composer:purge.cipherDriftWarn',
    )
  })

  it('stages explicit cache-impact confirmation when changing prefix-breaking options mid-session', async () => {
    useUIStore.setState({
      historySessionFile: '/tmp/proj/s1.jsonl',
      timelineItems: [{ id: 'u1', type: 'user-message', text: 'hi', timestamp: 1 } as never],
      optimisticPendingUserText: null,
    })
    useAgentPurgeStore.setState({
      purgedSessions: {
        '/tmp/proj/s1.jsonl': {
          personaId: 'konata',
          personaName: '泉此方 · 沙箱执行',
          mode: 'replace',
          body: '# Konata',
          strategy: { ...DEFAULT_PURGE_STRATEGY },
          lockedAt: 1,
        },
      },
    })

    render(<ComposerPurgeToggle draftContextKey="s1" running={false} />)

    fireEvent.click(screen.getByLabelText('composer:purge.choosePersona'))
    fireEvent.click(screen.getByText('composer:purge.presets.tunnel'))

    const confirmBox = screen.getByTestId('purge-mid-session-confirm')
    expect(confirmBox).toHaveTextContent('composer:purge.impactReasons.switch_tunnel')
    expect(invokeMock).not.toHaveBeenCalledWith('purge.setSession', expect.anything())

    fireEvent.click(screen.getByTestId('purge-mid-session-apply'))
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'purge.setSession',
        expect.objectContaining({
          sessionFile: '/tmp/proj/s1.jsonl',
          enabled: true,
          strategy: expect.objectContaining({
            historyMode: 'tunnel',
            toolOutputRelay: true,
            thinkingGuidance: 'tool_cot',
          }),
        }),
      )
    })
  })

  it('switches thinkingGuidance directly on turn 1 and selects tool_cot with relay enabled', () => {
    render(<ComposerPurgeToggle draftContextKey="draft-cot" running={false} />)
    fireEvent.click(screen.getByLabelText('composer:purge.choosePersona'))
    fireEvent.click(screen.getByTestId('purge-thinking-tool_cot'))
    expect(useAgentPurgeStore.getState().draftStrategy).toMatchObject({
      thinkingGuidance: 'tool_cot',
      toolOutputRelay: true,
    })
  })
})
