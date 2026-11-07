import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView from '../markdown-view'

describe('MarkdownView code block', () => {
  it('scrolls globally by default, activates internal scroll on click, and exits on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <MarkdownView>{'```json\n{"ok": true}\n```'}</MarkdownView>
      </div>,
    )

    const code = screen.getByText('{"ok": true}')
    const scrollContainer = code.closest('pre')!
    expect(scrollContainer).not.toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-hidden')

    fireEvent.click(scrollContainer)
    expect(scrollContainer).toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-auto', 'overscroll-contain')

    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(scrollContainer).not.toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-hidden')
  })
})

describe('MarkdownView pi-ui blocks', () => {
  const block = '```pi-ui\n{"component":"stat-grid","id":"k","props":{"items":[{"label":"Revenue","value":"42"}]}}\n```'

  it('renders a pi-ui fence as a component outside <pre>', async () => {
    const { container } = render(<MarkdownView>{`Summary:\n\n${block}`}</MarkdownView>)
    const label = await screen.findByText('Revenue', undefined, { timeout: 5000 })
    expect(label.closest('.uib-root')).not.toBeNull()
    expect(label.closest('pre')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('shows a skeleton instead of raw JSON while the block streams', () => {
    const partial = 'Summary of the numbers first.\n\n```pi-ui\n{"component":"stat-grid","props":{"items":[{"label":"Revenue",'
    const { container } = render(<MarkdownView streaming>{partial}</MarkdownView>)
    expect(container.querySelector('.uib-skeleton[data-kind="cards"]')).not.toBeNull()
    expect(container.textContent).not.toContain('"component"')
  })

  it('keeps ordinary code fences in the regular code block and activates scroll on click', () => {
    render(<MarkdownView>{'```pi\nnot a ui block\n```'}</MarkdownView>)
    const pre = screen.getByText('not a ui block').closest('pre')!
    expect(pre).not.toBeNull()
    fireEvent.click(pre)
    expect(pre).toHaveAttribute('data-independent-scroll')
  })
})
