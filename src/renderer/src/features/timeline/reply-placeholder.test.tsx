import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ReplyPlaceholder } from './reply-placeholder'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.values(values).join(',')})` : key,
  }),
}))

describe('ReplyPlaceholder', () => {
  beforeEach(() => {
    useUIStore.setState({ agentTurnBootstrapping: true, pendingTurnStage: 'starting' })
  })

  // A first message waits on session + worker creation before the model starts; say so.
  it('names the current wait stage instead of a generic thinking label', () => {
    render(<ReplyPlaceholder startedAt={Date.now()} labelSeed="opt-asst-1" />)
    expect(screen.getByText('timeline:pendingStage.starting')).toBeInTheDocument()

    act(() => useUIStore.getState().setPendingTurnStage('sending'))
    expect(screen.getByText('timeline:pendingStage.sending')).toBeInTheDocument()
  })

  it('falls back to the live thinking label once bootstrapping ends', () => {
    render(<ReplyPlaceholder startedAt={Date.now()} labelSeed="opt-asst-1" />)
    act(() => useUIStore.setState({ agentTurnBootstrapping: false }))
    expect(screen.queryByText(/pendingStage/)).not.toBeInTheDocument()
    expect(screen.getByText(/timeline:thinkingLive\./)).toBeInTheDocument()
  })

  it('shows the wait time after two seconds', () => {
    vi.useFakeTimers()
    try {
      render(<ReplyPlaceholder startedAt={Date.now()} labelSeed="opt-asst-1" />)
      act(() => {
        vi.advanceTimersByTime(3200)
      })
      expect(screen.getByText('timeline:pendingStage.elapsed(timeline:pendingStage.starting,3)')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
