import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import MarkdownView from '../markdown-view'
import { MarkdownLink } from '../markdown-link'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const href = 'https://github.com/justhil/pi-app/pull/109'
const markdown = `[**PR #109**](${href})`
const preview = { url: href, title: 'Fix &amp; improve sessions', description: 'Keep the first message.', image: 'data:image/png;base64,AA==' }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(ipcClient.invoke).mockReset().mockResolvedValue(preview)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  document.documentElement.style.zoom = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function hoverLink() {
  fireEvent.mouseEnter(screen.getByRole('link', { name: 'PR #109' }))
  await act(async () => { vi.advanceTimersByTime(800) })
}

describe('Markdown links', () => {
  it('opens a web link externally from a keyboard accessible context menu', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({ ok: true })
    render(<MarkdownView>{markdown}</MarkdownView>)
    fireEvent.contextMenu(screen.getByText('PR #109'), { clientX: 100, clientY: 120 })
    const open = screen.getByRole('menuitem', { name: 'Open in external browser' })
    expect(open).toHaveFocus()
    fireEvent.keyDown(open, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus()
    await act(async () => { fireEvent.click(open) })
    expect(ipcClient.invoke).toHaveBeenCalledExactlyOnceWith('shell.openExternal', { url: href })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('copies the destination including its query and fragment, and reports clipboard failure', async () => {
    const url = `${href}?a=1&b=2#diff`
    render(<MarkdownView>{`[PR](${url})`}</MarkdownView>)
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })) })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url)
    expect(toast.success).toHaveBeenCalledWith('Copied')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })) })
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy the link. Try again.")
  })

  it('fetches only after hovering, decodes metadata, and stays open while entering the card', async () => {
    vi.useFakeTimers()
    render(<MarkdownView>{markdown}</MarkdownView>)
    const link = screen.getByRole('link', { name: 'PR #109' })
    fireEvent.mouseEnter(link)
    act(() => { vi.advanceTimersByTime(799) })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    const card = screen.getByRole('dialog', { name: 'Link preview' })
    expect(screen.getByText('Fix & improve sessions')).toBeInTheDocument()
    expect(screen.getByText(preview.description)).toBeInTheDocument()
    expect(card.querySelector('img')).toHaveAttribute('src', preview.image)
    fireEvent.mouseLeave(link)
    fireEvent.mouseEnter(card)
    act(() => { vi.advanceTimersByTime(200) })
    expect(card).toBeInTheDocument()
    fireEvent.mouseLeave(card)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancels brief hovers and pending timers on unmount', async () => {
    vi.useFakeTimers()
    const { unmount } = render(<MarkdownView>{markdown}</MarkdownView>)
    const link = screen.getByRole('link')
    fireEvent.mouseEnter(link)
    fireEvent.mouseLeave(link)
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    fireEvent.mouseEnter(link)
    unmount()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('supports keyboard preview and dismissal when metadata is unavailable', async () => {
    vi.mocked(ipcClient.invoke).mockRejectedValue(new Error('offline'))
    render(<MarkdownView>{markdown}</MarkdownView>)
    await act(async () => { screen.getByRole('link').focus() })
    const card = screen.getByRole('dialog')
    expect(card).toHaveTextContent(href)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveFocus()
  })

  it('copies local links without fetching or offering a browser action', async () => {
    render(<MarkdownView>{'[source](/home/user/project/source.ts:12)'}</MarkdownView>)
    fireEvent.keyDown(screen.getByRole('link'), { key: 'F10', shiftKey: true })
    expect(screen.queryByRole('menuitem', { name: 'Open in external browser' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' })) })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/home/user/project/source.ts:12')
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('handles web links in committed streaming blocks', async () => {
    vi.useFakeTimers()
    render(<MarkdownView streaming>{`${markdown}\n\n${'More details are being generated. '.repeat(4)}`}</MarkdownView>)
    await hoverLink()
    expect(screen.getByRole('dialog')).toHaveTextContent('Fix & improve sessions')
  })

  it('limits the card width in narrow windows with UI zoom', async () => {
    vi.stubGlobal('innerWidth', 320)
    document.documentElement.style.zoom = '1.5'
    render(<MarkdownView>{markdown}</MarkdownView>)
    await act(async () => { screen.getByRole('link').focus() })
    expect(screen.getByRole('dialog').style.maxWidth).toBe(`${(320 - 16) / 1.5}px`)
  })

  it('ignores metadata from a link that changed while its request was pending', async () => {
    let resolveOld!: (value: typeof preview) => void
    vi.mocked(ipcClient.invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const { rerender } = render(<MarkdownLink href={href}>Old link</MarkdownLink>)
    fireEvent.focus(screen.getByRole('link'))
    rerender(<MarkdownLink href="https://example.com/new">New link</MarkdownLink>)
    vi.mocked(ipcClient.invoke).mockResolvedValue({ url: 'https://example.com/new', title: 'New preview' })
    await act(async () => { fireEvent.focus(screen.getByRole('link')); resolveOld(preview) })
    expect(screen.getByRole('dialog')).toHaveTextContent('New preview')
    expect(screen.queryByText('Fix & improve sessions')).not.toBeInTheDocument()
  })
})
