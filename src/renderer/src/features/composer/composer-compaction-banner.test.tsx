import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerCompactionBanner } from './composer-compaction-banner'

describe('ComposerCompactionBanner', () => {
  beforeEach(() => {
    useUIStore.setState({ compactingSessions: {}, historySessionFile: '/s.jsonl' })
  })

  it('renders nothing while no compaction is running', () => {
    render(<ComposerCompactionBanner />)
    expect(screen.queryByText(/compacting context/i)).toBeNull()
  })

  it('tells the user they can keep sending while compaction runs', () => {
    useUIStore.setState({ compactingSessions: { '/s.jsonl': true } })
    render(<ComposerCompactionBanner />)
    expect(screen.getByText(/compacting context/i)).toBeTruthy()
  })

  it('disappears when compaction ends', () => {
    useUIStore.setState({ compactingSessions: { '/s.jsonl': true } })
    const { rerender } = render(<ComposerCompactionBanner />)
    expect(screen.getByText(/compacting context/i)).toBeTruthy()
    useUIStore.setState({ compactingSessions: { '/s.jsonl': false } })
    rerender(<ComposerCompactionBanner />)
    expect(screen.queryByText(/compacting context/i)).toBeNull()
  })

  it('does not show another session compaction on the current view', () => {
    useUIStore.setState({ compactingSessions: { '/other.jsonl': true } })
    render(<ComposerCompactionBanner />)
    expect(screen.queryByText(/compacting context/i)).toBeNull()
  })
})
