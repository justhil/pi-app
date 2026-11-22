import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThinkingChainBlock } from './thinking-chain-block'

describe('ThinkingChainBlock', () => {
  it('should_render_readable_independent_scroll_body_when_expanded', () => {
    const text = 'Inspect the event target before forwarding the wheel delta.'
    render(<ThinkingChainBlock text={text} />)

    fireEvent.click(screen.getByRole('button'))

    const body = screen.getByText(text)
    expect(body).toHaveAttribute('data-independent-scroll')
    expect(body).toHaveClass(
      'max-h-96',
      'overflow-y-auto',
      'overscroll-contain',
      'border-border/35',
      'text-[13px]',
      'leading-[1.62]',
      'thinking-chain-body',
    )
    expect(body).not.toHaveClass('font-mono', 'timeline-text-placeholder')
  })

  it('renders a bottom collapse button when expanded thinking exceeds 8 lines and shows live snippet while streaming', () => {
    const multiLine = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}: analyze layout`).join('\n')
    const { rerender } = render(<ThinkingChainBlock text={multiLine} streaming />)

    // Collapsed live state previews the latest reasoning line
    expect(screen.getByText('Step 10: analyze layout')).toBeInTheDocument()

    // Expand -> bottom collapse button appears alongside header button
    fireEvent.click(screen.getByRole('button'))
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(2)

    // Clicking bottom collapse closes the block
    fireEvent.click(buttons[1])
    rerender(<ThinkingChainBlock text={multiLine} />)
    expect(screen.queryByText(/Step 1: analyze layout/)).toBeNull()
  })
})
