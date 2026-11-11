import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentPurgeConfig } from '@shared/agent-purge'
import {
  commitPurgedSessionAfterSend,
  consumeDraftPurgeForFirstSend,
  useAgentPurgeStore,
} from '@renderer/lib/agent-purge-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerPurgeToggle } from './composer-purge-toggle'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: vi.fn(() =>
      Promise.resolve({
        config: defaultAgentPurgeConfig(),
        purgedSessions: {},
        localDir: '',
      }),
    ),
  },
}))

describe('ComposerPurgeToggle state machine', () => {
  beforeEach(() => {
    useAgentPurgeStore.setState({
      loaded: true,
      config: defaultAgentPurgeConfig(),
      purgedSessions: {},
      localDir: '',
      draftContextKey: 'draft-1',
      draftEnabled: false,
      draftPersonaId: null,
      draftMode: null,
      pendingLock: null,
    })
    useUIStore.setState({
      historySessionFile: null,
      timelineItems: [],
      optimisticPendingUserText: null,
    })
  })

  it('starts OFF on a brand-new chat, toggles ON, and locks ON + disabled once the first message sends', () => {
    const { rerender } = render(<ComposerPurgeToggle draftContextKey="draft-1" running={false} />)

    const btn = screen.getByTestId('composer-purge-toggle')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('data-purge-state', 'draft-off')

    // User enables Purge on the new draft
    fireEvent.click(btn)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('data-purge-state', 'draft-on')

    // First message is sent and materializes /sessions/chat-1.jsonl
    let sendPayload: ReturnType<typeof consumeDraftPurgeForFirstSend>
    act(() => {
      sendPayload = consumeDraftPurgeForFirstSend(true)
      useUIStore.setState({ historySessionFile: '/sessions/chat-1.jsonl' })
      commitPurgedSessionAfterSend('/sessions/chat-1.jsonl')
    })
    expect(sendPayload).toEqual({
      enabled: true,
      personaId: 'dafeiyu',
      mode: 'replace',
    })
    rerender(<ComposerPurgeToggle draftContextKey="session:/sessions/chat-1.jsonl" running={false} />)

    const lockedBtn = screen.getByTestId('composer-purge-toggle')
    expect(lockedBtn).toBeDisabled()
    expect(lockedBtn).toHaveAttribute('aria-pressed', 'true')
    expect(lockedBtn).toHaveAttribute('data-purge-state', 'locked-on')

    // Clicking the locked button cannot turn it off
    fireEvent.click(lockedBtn)
    expect(lockedBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders OFF and disabled on existing conversations where Purge was not enabled on turn 1', () => {
    useUIStore.setState({ historySessionFile: '/sessions/existing-normal.jsonl' })
    render(<ComposerPurgeToggle draftContextKey="session:/sessions/existing-normal.jsonl" running={false} />)

    const btn = screen.getByTestId('composer-purge-toggle')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('data-purge-state', 'locked-off')
  })

  it('resets back to OFF when opening another brand-new conversation', () => {
    const { rerender } = render(<ComposerPurgeToggle draftContextKey="draft-a" running={false} />)
    fireEvent.click(screen.getByTestId('composer-purge-toggle'))
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'true')

    rerender(<ComposerPurgeToggle draftContextKey="draft-b" running={false} />)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'false')
  })
})
