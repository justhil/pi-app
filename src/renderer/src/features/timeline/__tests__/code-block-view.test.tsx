import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeBlockView } from '../code-block-view'

vi.mock('@renderer/lib/shiki-highlighter', () => ({
  highlightCodeToHtml: vi.fn().mockResolvedValue('<pre><code>const x = 1</code></pre>'),
}))

describe('CodeBlockView', () => {
  it('renders code with language label', async () => {
    render(<CodeBlockView code="const x = 1" lang="typescript" />)
    expect(await screen.findByText('typescript')).toBeInTheDocument()
  })

  it('marks the scroll container as independent and contains overscroll', () => {
    const { container } = render(<CodeBlockView code="hello" lang="text" />)

    const scrollContainer = container.querySelector('.native-code-shiki')
    expect(scrollContainer).toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-auto', 'overscroll-contain')
  })

  it('shows copy control', async () => {
    render(<CodeBlockView code="hello" lang="text" />)
    expect(await screen.findByRole('button', { name: /copy|复制|copied|已复制/i })).toBeInTheDocument()
  })
})
