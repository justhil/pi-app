import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView, { CODE_FOLD_THRESHOLD_LINES } from '../markdown-view'

describe('MarkdownView code block', () => {
  it('shows blocks up to the fold threshold in full with horizontal-only overflow (no wheel hijack)', () => {
    const shortCode = Array.from({ length: 12 }, (_, i) => `const line${i + 1} = ${i + 1}`).join('\n')
    render(<MarkdownView>{`\`\`\`ts\n${shortCode}\n\`\`\``}</MarkdownView>)

    const pre = screen.getByText(/const line1 = 1/).closest('pre')!
    expect(pre).toHaveClass('overflow-x-auto', 'overflow-y-visible')
    expect(pre).not.toHaveClass('overflow-hidden', 'max-h-[4.5rem]')
    expect(screen.queryByRole('button', { name: /expand|展开|Показать/i })).toBeNull()
  })

  it('folds blocks exceeding the threshold with an explicit line-count button and sticky collapse bar when expanded', () => {
    const longCode = Array.from(
      { length: CODE_FOLD_THRESHOLD_LINES + 6 },
      (_, i) => `console.log("row-${i + 1}")`,
    ).join('\n')
    const { container } = render(<MarkdownView>{`\`\`\`ts\n${longCode}\n\`\`\``}</MarkdownView>)

    const pre = screen.getByText(/row-1/).closest('pre')!
    expect(pre).toHaveClass('max-h-[19.25rem]', 'overflow-hidden')

    const expandBtns = container.querySelectorAll('button[aria-expanded="false"]')
    expect(expandBtns.length).toBe(1)
    fireEvent.click(expandBtns[0])

    expect(pre).toHaveClass('overflow-x-auto', 'overflow-y-visible')
    const stickyHeader = container.querySelector('.code-surface > .sticky')
    expect(stickyHeader).not.toBeNull()
    expect(container.querySelectorAll('button[aria-expanded="true"]').length).toBe(1)
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

  it('keeps ordinary code fences in the regular code block with horizontal scroll ready', () => {
    render(<MarkdownView>{'```pi\nnot a ui block\n```'}</MarkdownView>)
    const pre = screen.getByText('not a ui block').closest('pre')!
    expect(pre).not.toBeNull()
    expect(pre).toHaveClass('overflow-x-auto')
  })
})
