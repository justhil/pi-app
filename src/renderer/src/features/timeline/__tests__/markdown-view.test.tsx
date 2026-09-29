import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView from '../markdown-view'

describe('MarkdownView code block', () => {
  it('marks fenced code as an independent scroll region and contains overscroll', () => {
    render(<MarkdownView>{'```json\n{"ok": true}\n```'}</MarkdownView>)

    const code = screen.getByText('{"ok": true}')
    const scrollContainer = code.closest('pre')
    expect(scrollContainer).toHaveAttribute('data-independent-scroll')
    expect(scrollContainer).toHaveClass('overflow-auto', 'overscroll-contain')
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

  it('keeps ordinary code fences in the regular code block', () => {
    render(<MarkdownView>{'```pi\nnot a ui block\n```'}</MarkdownView>)
    expect(screen.getByText('not a ui block').closest('pre')).toHaveAttribute('data-independent-scroll')
  })
})
