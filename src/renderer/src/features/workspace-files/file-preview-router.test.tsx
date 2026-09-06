import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FilePreviewRouter } from './file-preview-router'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn() } }))
vi.mock('@renderer/features/timeline/markdown-view', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }))
vi.mock('./file-source-preview', () => ({ FileSourcePreview: ({ code }: { code: string }) => <pre>{code}</pre> }))
afterEach(cleanup)
describe('file preview', () => {
  it('marks truncated text and lets the user load more without losing the prefix', async () => {
    const readText = vi.fn().mockResolvedValueOnce({ ok: true, content: 'partial content', size: 600000, truncated: true }).mockResolvedValue({ ok: true, content: 'complete content', size: 600000, truncated: false })
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="large.txt" readText={readText} />)
    await screen.findByText('partial content')
    fireEvent.click(screen.getByRole('button', { name: 'preview.tryExpandRead' }))
    await screen.findByText('complete content')
    expect(screen.queryByRole('button', { name: 'preview.tryExpandRead' })).toBeNull()
  })
  it('allows HTML animation scripts without same-origin or top-navigation privileges', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '<script>requestAnimationFrame(() => {})</script>', size: 60 })
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="动画.html" readText={readText} />)
    const frame = await screen.findByTitle('html-preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(frame.getAttribute('srcdoc')).toContain('connect-src')
  })
  it('reports a rejected read instead of staying in loading', async () => {
    render(<FilePreviewRouter workspaceRoot="/ws" relativePath="a.txt" readText={vi.fn().mockRejectedValue(new Error('read failed'))} />)
    await screen.findByText('preview.error')
    expect(screen.queryByText('preview.loading')).toBeNull()
  })
  it('ignores a pending read when another file is selected', async () => {
    let finish!: (v: { ok: boolean; content: string }) => void
    const readText = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true, content: 'current' })
    const view = render(<FilePreviewRouter workspaceRoot="/ws" relativePath="a.txt" readText={readText} />)
    view.rerender(<FilePreviewRouter workspaceRoot="/ws" relativePath="b.txt" readText={readText} />)
    await screen.findByText('current')
    finish({ ok: true, content: 'obsolete' })
    await waitFor(() => expect(screen.queryByText('obsolete')).toBeNull())
  })
})
