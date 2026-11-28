import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalTooltipHost } from '../global-tooltip-host'

describe('GlobalTooltipHost', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows rounded tooltip for icon-only buttons and suppresses native title', () => {
    render(
      <>
        <button type="button" data-testid="icon-btn" title="Notifications">
          <svg aria-hidden="true" />
        </button>
        <GlobalTooltipHost />
      </>,
    )

    const btn = screen.getByTestId('icon-btn')
    fireEvent.pointerOver(btn)
    expect(btn.getAttribute('title')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Notifications')
  })

  it('suppresses tooltip on buttons whose label text is already visible without truncation', () => {
    render(
      <>
        <button type="button" data-testid="text-btn" title="Thinking: High (Shift+Tab)">
          Thinking High
        </button>
        <GlobalTooltipHost />
      </>,
    )

    const btn = screen.getByTestId('text-btn')
    fireEvent.pointerOver(btn)
    expect(btn.getAttribute('title')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
