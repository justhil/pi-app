import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CodeBlockView } from '../code-block-view'

vi.mock('@renderer/lib/shiki-highlighter', () => ({
  highlightCodeToHtml: vi.fn().mockResolvedValue('<pre><code>const x = 1</code></pre>'),
}))

describe('CodeBlockView', () => {
  it('renders code with language label', async () => {
    render(<CodeBlockView code="const x = 1" lang="typescript" />)
    expect(await screen.findByText('typescript')).toBeInTheDocument()
  })

  it('scrolls globally by default, activates internal scroll on click, and exits on outside click', () => {
    const { container } = render(
      <div>
        <div data-testid="outside">Outside</div>
        <CodeBlockView code="hello" lang="text" />
      </div>,
    )

    const scrollContainer = container.querySelector('.native-code-shiki')!
    expect(scrollContainer).not.toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-hidden')

    fireEvent.click(scrollContainer)
    expect(scrollContainer).toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-auto', 'overscroll-contain')

    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(scrollContainer).not.toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-hidden')
  })

  it('shows copy control', async () => {
    render(<CodeBlockView code="hello" lang="text" />)
    expect(await screen.findByRole('button', { name: /copy|复制|copied|已复制/i })).toBeInTheDocument()
  })
})
