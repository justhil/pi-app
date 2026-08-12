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
