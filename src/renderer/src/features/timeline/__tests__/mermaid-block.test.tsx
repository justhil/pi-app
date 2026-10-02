import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import MarkdownView from '../markdown-view'

const renderMermaid = vi.fn(async (code: string) =>
  code.includes('oops') ? { error: 'Parse error on line 2' } : { svg: `<svg data-testid="diagram"><text>${code.length}</text></svg>` },
)
vi.mock('../mermaid-render', () => ({ renderMermaid: (code: string) => renderMermaid(code) }))

const fence = (body: string) => ['Flow:', '', '```mermaid', body, '```', ''].join('\n')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  renderMermaid.mockClear()
  document.documentElement.classList.remove('dark')
})

describe('mermaid fences', () => {
  it('shows the source while streaming and renders the diagram once settled', async () => {
    const source = 'graph TD\n  A --> B'
    const { container, rerender } = render(<MarkdownView streaming>{fence(source)}</MarkdownView>)
    expect(container.querySelector('[data-mermaid-state="streaming"] code')?.textContent).toBe(source)
    expect(renderMermaid).not.toHaveBeenCalled()

    rerender(<MarkdownView>{fence(source)}</MarkdownView>)
    await waitFor(() => expect(container.querySelector('[data-mermaid-state="rendered"] svg')).not.toBeNull())
    expect(renderMermaid).toHaveBeenCalledWith(source)
    expect(container.querySelector('[data-mermaid-state] pre')).toBeNull()
  })

  it('toggles between diagram and source', async () => {
    const { container } = render(<MarkdownView>{fence('graph LR\n  X --> Y')}</MarkdownView>)
    await waitFor(() => expect(container.querySelector('.mermaid-diagram svg')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    expect(container.querySelector('.mermaid-diagram')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('X --> Y')
    fireEvent.click(screen.getByRole('button', { name: 'View diagram' }))
    expect(container.querySelector('.mermaid-diagram svg')).not.toBeNull()
  })

  it('falls back to the source with the parser message when the diagram is invalid', async () => {
    const { container } = render(<MarkdownView>{fence('graph TD\n  oops ->')}</MarkdownView>)
    await waitFor(() => expect(container.querySelector('[data-mermaid-state="error"]')).not.toBeNull())
    expect(container.querySelector('pre code')?.textContent).toContain('oops ->')
    expect(container.textContent).toContain("Couldn't render this diagram: Parse error on line 2")
    // Not nested in the Markdown <pre>, which would force monospace and no wrapping on the message.
    expect(container.querySelector('[data-mermaid-state]')?.closest('pre')).toBeNull()
  })

  it('reuses the cached diagram on remount and re-renders when the theme changes', async () => {
    const source = 'graph TD\n  Cache --> Hit'
    const first = render(<MarkdownView>{fence(source)}</MarkdownView>)
    await waitFor(() => expect(first.container.querySelector('.mermaid-diagram svg')).not.toBeNull())
    first.unmount()
    renderMermaid.mockClear()

    const second = render(<MarkdownView>{fence(source)}</MarkdownView>)
    expect(second.container.querySelector('.mermaid-diagram svg')).not.toBeNull()
    expect(renderMermaid).not.toHaveBeenCalled()

    await act(async () => {
      document.documentElement.classList.add('dark')
    })
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1))
  })
})
