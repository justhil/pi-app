import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileSourcePreview } from './file-source-preview'
import { PREVIEW_SHIKI_MAX_CHARS } from './file-preview-limits'
vi.mock('@renderer/lib/shiki-highlighter', () => ({ highlightCodeToHtml: vi.fn().mockResolvedValue('') }))
vi.mock('@renderer/components/ui/line-gutter-add', () => ({ LineGutterAddButton: () => <button>line-ref</button> }))
afterEach(cleanup)
it('renders all large source content without creating a button per line', () => {
  const code = `${'x'.repeat(500)}\n`.repeat(Math.ceil(PREVIEW_SHIKI_MAX_CHARS / 500) + 1)
  const { container } = render(<FileSourcePreview code={code} path="large.ts" />)
  expect(container.querySelector('pre')?.textContent).toBe(code)
  expect(container.querySelectorAll('button')).toHaveLength(0)
})
