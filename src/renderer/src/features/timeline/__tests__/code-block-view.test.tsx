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

  it('shows copy control', async () => {
    render(<CodeBlockView code="hello" lang="text" />)
    expect(await screen.findByRole('button', { name: /copy|复制|copied|已复制/i })).toBeInTheDocument()
  })
})
