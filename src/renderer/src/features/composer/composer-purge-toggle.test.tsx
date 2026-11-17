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

const invokeMock = vi.fn((channel: string, _payload?: unknown) => {
  if (channel === 'purge.setSession') return Promise.resolve({ ok: true })
  return Promise.resolve({
    config: defaultAgentPurgeConfig(),
    purgedSessions: {},
    localDir: '',
  })
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
  },
}))

describe('ComposerPurgeToggle state machine', () => {
  beforeEach(() => {
    invokeMock.mockClear()
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

  it('starts OFF on a brand-new chat, commits on first send, and remains switchable/togglable mid-session', () => {
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
      personaId: 'konata',
      mode: 'replace',
    })
    rerender(<ComposerPurgeToggle draftContextKey="session:/sessions/chat-1.jsonl" running={false} />)

    const midBtn = screen.getByTestId('composer-purge-toggle')
    expect(midBtn).not.toBeDisabled()
    expect(midBtn).toHaveAttribute('aria-pressed', 'true')
    expect(midBtn).toHaveAttribute('data-purge-state', 'active-mid')

    // Clicking mid-session turns it off via purge.setSession
    fireEvent.click(midBtn)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(invokeMock).toHaveBeenCalledWith(
      'purge.setSession',
      expect.objectContaining({ sessionFile: '/sessions/chat-1.jsonl', enabled: false }),
    )
  })

  it('allows enabling Purge mid-session on existing conversations and shows cache invalidation warning', () => {
    useUIStore.setState({ historySessionFile: '/sessions/existing-normal.jsonl' })
    render(<ComposerPurgeToggle draftContextKey="session:/sessions/existing-normal.jsonl" running={false} />)

    const btn = screen.getByTestId('composer-purge-toggle')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('data-purge-state', 'off-mid')

    fireEvent.click(btn)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(invokeMock).toHaveBeenCalledWith(
      'purge.setSession',
      expect.objectContaining({ sessionFile: '/sessions/existing-normal.jsonl', enabled: true }),
    )
  })

  it('resets back to OFF when opening another brand-new conversation', () => {
    const { rerender } = render(<ComposerPurgeToggle draftContextKey="draft-a" running={false} />)
    fireEvent.click(screen.getByTestId('composer-purge-toggle'))
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'true')

    rerender(<ComposerPurgeToggle draftContextKey="draft-b" running={false} />)
    expect(screen.getByTestId('composer-purge-toggle')).toHaveAttribute('aria-pressed', 'false')
  })
})
