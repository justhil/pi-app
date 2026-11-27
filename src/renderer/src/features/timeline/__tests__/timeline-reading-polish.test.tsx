// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserMessageBubble, USER_MESSAGE_FOLD_LINES } from '../user-message-content'
import { TimelineSelectionToolbar, formatQuotedSelection } from '../timeline-selection-toolbar'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRef } from 'react'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string, opts?: Record<string, unknown>) =>
        opts?.count != null ? `${k}:${opts.count}` : k,
    }),
  }
})

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

describe('UserMessageBubble', () => {
  it('renders fenced code blocks and inline backtick code inside user messages', () => {
    const raw = 'Check `config.json` with:\n```bash\npnpm typecheck\n```'
    const { container } = render(
      <UserMessageBubble segments={[{ type: 'text', text: raw }]} rawText={raw} />,
    )
    expect(container.querySelector('code.timeline-user-inline-code')?.textContent).toBe('config.json')
    expect(container.querySelector('pre.timeline-user-code-fence code')?.textContent).toBe('pnpm typecheck')
  })

  it('auto-folds user messages longer than 8 lines and toggles expansion cleanly', () => {
    const raw = Array.from({ length: USER_MESSAGE_FOLD_LINES + 5 }, (_, i) => `Error line ${i + 1}`).join('\n')
    const { container } = render(
      <UserMessageBubble segments={[{ type: 'text', text: raw }]} rawText={raw} />,
    )
    expect(container.querySelector('.timeline-user-collapse-fade')).not.toBeNull()
    const toggle = screen.getByRole('button', { name: `timeline:expand:${USER_MESSAGE_FOLD_LINES + 5}` })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.timeline-user-collapse-fade')).toBeNull()
  })
})

describe('TimelineSelectionToolbar & formatQuotedSelection', () => {
  it('formats single and multi-line selections as clean Markdown blockquotes', () => {
    expect(formatQuotedSelection('hello world')).toBe('> hello world\n\n')
    expect(formatQuotedSelection('line 1\n\nline 3')).toBe('> line 1\n>\n> line 3\n\n')
  })

  it('reveals Copy | Quote on selection inside timeline content and appends blockquote to composer draft', () => {
    useUIStore.setState({ composerPrefill: null, composerPrefillMode: 'replace' })

    function Harness({ canQuote }: { canQuote: boolean }) {
      const containerRef = useRef<HTMLDivElement>(null)
      const contentRef = useRef<HTMLDivElement>(null)
      const scrollRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={containerRef} style={{ width: 600, height: 400 }}>
          <div ref={scrollRef}>
            <div ref={contentRef}>
              <p data-testid="reply-line">Important architectural conclusion</p>
            </div>
          </div>
          <TimelineSelectionToolbar
            containerRef={containerRef}
            contentRef={contentRef}
            scrollRef={scrollRef}
            canQuote={canQuote}
          />
        </div>
      )
    }

    const { rerender } = render(<Harness canQuote />)
    const p = screen.getByTestId('reply-line')
    const range = document.createRange()
    range.selectNodeContents(p.firstChild!)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })

    const quoteBtn = screen.getByRole('button', { name: 'timeline:quoteSelection' })
    fireEvent.click(quoteBtn)

    expect(useUIStore.getState().composerPrefill).toBe('> Important architectural conclusion\n\n')
    expect(useUIStore.getState().composerPrefillMode).toBe('append')

    // Read-only mode hides Quote button and shows only Copy
    sel.removeAllRanges()
    sel.addRange(range)
    rerender(<Harness canQuote={false} />)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(screen.getByRole('button', { name: 'timeline:copy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'timeline:quoteSelection' })).toBeNull()
  })
})


