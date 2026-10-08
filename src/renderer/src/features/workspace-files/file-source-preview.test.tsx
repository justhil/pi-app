import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileSourcePreview } from './file-source-preview'
import { PREVIEW_SHIKI_MAX_CHARS } from './file-preview-limits'
import { highlightCodeToHtml } from '@renderer/lib/shiki-highlighter'
vi.mock('@renderer/lib/shiki-highlighter', () => ({ highlightCodeToHtml: vi.fn().mockResolvedValue('') }))
vi.mock('@renderer/components/ui/line-gutter-add', () => ({ LineGutterAddButton: () => <button>line-ref</button> }))
const originalScrollIntoView = Element.prototype.scrollIntoView
afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.mocked(highlightCodeToHtml).mockReset().mockResolvedValue('')
})
it('renders all large source content without creating a button per line', () => {
  const code = `${'x'.repeat(500)}\n`.repeat(Math.ceil(PREVIEW_SHIKI_MAX_CHARS / 500) + 1)
  const { container } = render(<FileSourcePreview code={code} path="large.ts" />)
  expect(container.querySelector('pre')?.textContent).toBe(code)
  expect(container.querySelectorAll('button')).toHaveLength(0)
})

it('reveals and highlights the requested line after highlighting loads and on repeated clicks', async () => {
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  let finish!: (html: string) => void
  vi.mocked(highlightCodeToHtml).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<FileSourcePreview code={'first\nsecond\nthird'} sourceLocation={{ line: 2 }} />)
  expect(view.container.querySelector('[data-source-line="2"]')).toHaveTextContent('second')
  finish('<pre><code><span class="line">first</span>\n<span class="line">second</span>\n<span class="line">third</span></code></pre>')
  await waitFor(() => expect(view.container.querySelector('.native-code-shiki [data-source-line="2"]')).toHaveClass('bg-accent/15'))
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(view.container.querySelector('[data-source-line="2"]'))
  scrollIntoView.mockClear()
  view.rerender(<FileSourcePreview code={'first\nsecond\nthird'} sourceLocation={{ line: 2 }} />)
  expect(scrollIntoView).toHaveBeenCalledOnce()
  view.rerender(<FileSourcePreview code={'first\nsecond\nthird'} sourceLocation={{ line: 3 }} />)
  expect(view.container.querySelector('[data-source-line="2"]')).toBeNull()
  expect(view.container.querySelector('[data-source-line="3"]')).toHaveTextContent('third')
})

it('reveals large plain source without losing text or creating a button per line', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const code = `${'x'.repeat(500)}\n`.repeat(Math.ceil(PREVIEW_SHIKI_MAX_CHARS / 500) + 1)
  const { container } = render(<FileSourcePreview code={code} sourceLocation={{ line: 128 }} />)
  expect(container.querySelector('pre')?.textContent).toBe(code)
  expect(container.querySelector('[data-source-line="128"]')).toHaveClass('bg-accent/15')
  expect(container.querySelectorAll('button')).toHaveLength(0)
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce()
})

it('ignores line references beyond the loaded file', () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(highlightCodeToHtml).mockImplementation(() => new Promise(() => {}))
  const { container } = render(<FileSourcePreview code="one line" sourceLocation={{ line: 128 }} />)
  expect(container.querySelector('[data-source-line]')).toBeNull()
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
})

it('keeps the requested line visible when the highlighter falls back to unstyled text', async () => {
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  vi.mocked(highlightCodeToHtml).mockResolvedValue('<pre class="shiki"><code>first\nsecond</code></pre>')
  const view = render(<FileSourcePreview code={'first\nsecond'} sourceLocation={{ line: 2 }} />)
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
  expect(view.container.querySelector('[data-source-line="2"]')).toHaveTextContent('second')
  expect(view.container.querySelector('pre')?.textContent).toBe('first\nsecond')
})
