import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownView from '../markdown-view'
import { WorkspaceFilesPanel } from '@renderer/features/workspace-files/workspace-files-panel'
import { FilePreviewRouter } from '@renderer/features/workspace-files/file-preview-router'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import i18n from '@renderer/lib/i18n'
import { localFileLineFromHref, localFilePathFromHref } from '@renderer/lib/open-workspace-path'
import { toast } from 'sonner'

vi.mock('@renderer/features/workspace-files/file-tree', () => ({ FileTree: () => null }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({ ok: true }) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const root = '\\\\wsl.localhost\\Ubuntu\\home\\user\\project'
const path = '/home/user/project/output/pdf/实验 报告.pdf'
const markdown = `[下载实验报告](<${path}>)`

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  vi.mocked(ipcClient.invoke).mockReset().mockResolvedValue({ ok: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  useUIStore.setState({ currentWorkspace: root, workspaceFileToOpen: null, activePanel: 'review', rightPanelCollapsed: true })
})
const originalScrollIntoView = Element.prototype.scrollIntoView
afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = originalScrollIntoView
  vi.useRealTimers()
})

describe('Markdown file links', () => {
  it('opens a Chinese PDF on the first click before the Files panel mounts', () => {
    const view = render(<MarkdownView>{markdown}</MarkdownView>)
    const link = screen.getByRole('link', { name: '下载实验报告' })
    expect(link).toHaveAttribute('title', path)
    expect(fireEvent.click(link)).toBe(false)
    expect(useUIStore.getState()).toMatchObject({ activePanel: 'files', rightPanelCollapsed: false })
    view.rerender(<><MarkdownView>{markdown}</MarkdownView><WorkspaceFilesPanel /></>)
    expect(screen.getByRole('tab')).toHaveTextContent('实验 报告.pdf')
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'output/pdf/实验 报告.pdf')
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '下载实验报告' }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Open in system|在系统中打开/ }))
    expect(ipcClient.invoke).toHaveBeenCalledWith('shell.openPath', { path: `${root}\\output\\pdf\\实验 报告.pdf` })
  })

  it.each([
    'file:///home/user/project/output/pdf/%E5%AE%9E%E9%AA%8C%20%E6%8A%A5%E5%91%8A.pdf',
    'file://wsl.localhost/Ubuntu/home/user/project/output/pdf/%E5%AE%9E%E9%AA%8C%20%E6%8A%A5%E5%91%8A.pdf',
    'output/pdf/%E5%AE%9E%E9%AA%8C%20%E6%8A%A5%E5%91%8A.pdf#page=1',
  ])('keeps and decodes a local link: %s', (href) => {
    render(<MarkdownView>{`[report](${href})`}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: 'report' }))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('output/pdf/实验 报告.pdf')
  })

  it('handles file links in committed streaming blocks', () => {
    render(<MarkdownView streaming>{`${markdown}\n\n${'More details are being generated. '.repeat(4)}`}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: '下载实验报告' }))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('output/pdf/实验 报告.pdf')
  })

  it('opens a Windows drive link in its workspace instead of losing its href', () => {
    useUIStore.setState({ currentWorkspace: 'C:\\work' })
    render(<MarkdownView>{'[report](C:/work/report.pdf)'}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: 'report' }))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('report.pdf')
  })

  it('opens files outside the workspace using the system viewer', () => {
    render(<MarkdownView>{'[report](/home/user/other/report.pdf)'}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: 'report' }))
    expect(ipcClient.invoke).toHaveBeenCalledWith('shell.openPath', { path: '/home/user/other/report.pdf' })
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
  })

  it('previews and reveals a source citation on the first and repeated clicks without rereading', async () => {
    const sourcePath = '/home/user/project/plugins/schedule_service.py'
    const content = Array.from({ length: 150 }, (_, index) => `schedule_link_regression_${index + 1} = True`).join('\n')
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.mocked(ipcClient.invoke).mockImplementation(async (method, req) => {
      if (method === 'workspace.fs.readText') {
        return req.path === 'plugins/schedule_service.py'
          ? { ok: true, content }
          : { ok: false, error: 'not_found' }
      }
      return { ok: true }
    })
    const view = render(<MarkdownView>{`[schedule_service.py](${sourcePath}:128)`}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: 'schedule_service.py' }))
    expect(useUIStore.getState().workspaceFileToOpen).toEqual({ workspaceRoot: root, rel: 'plugins/schedule_service.py', line: 128 })
    view.rerender(<><MarkdownView>{`[schedule_service.py](${sourcePath}:128)`}</MarkdownView><WorkspaceFilesPanel /></>)
    await waitFor(() => expect(view.container.querySelector('[data-source-line="128"]')).toHaveTextContent('schedule_link_regression_128 = True'))
    expect(screen.getByRole('tab')).toHaveTextContent('schedule_service.py')
    expect(ipcClient.invoke).toHaveBeenCalledWith('workspace.fs.readText', expect.objectContaining({ path: 'plugins/schedule_service.py' }))
    await waitFor(() => expect(view.container.querySelector('.native-code-shiki [data-source-line="128"]')).toHaveClass('bg-accent/15'))
    scrollIntoView.mockClear()
    const readCount = vi.mocked(ipcClient.invoke).mock.calls.filter(([method]) => method === 'workspace.fs.readText').length
    fireEvent.click(screen.getByRole('link', { name: 'schedule_service.py' }))
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(vi.mocked(ipcClient.invoke).mock.calls.filter(([method]) => method === 'workspace.fs.readText')).toHaveLength(readCount)
  })

  it.each([
    ['/home/user/other/storage/optimize-job-store.ts:2647', '/home/user/other/storage/optimize-job-store.ts'],
    ['/home/user/other/solvers/schedule-result.ts:71', '/home/user/other/solvers/schedule-result.ts'],
  ])('opens a cross-project source citation without its line number: %s', (href, expected) => {
    render(<MarkdownView>{`[source](${href})`}</MarkdownView>)
    fireEvent.click(screen.getByRole('link'))
    expect(ipcClient.invoke).toHaveBeenCalledWith('shell.openPath', { path: expected })
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
  })

  it.each([
    ['script.ts:12:3', 'script.ts'],
    ['./script.py:12', './script.py'],
    ['C:/work/script.ts:12:3', 'C:/work/script.ts'],
    ['file:///home/user/script.py:12#section', '/home/user/script.py'],
    ['file://wsl.localhost/Ubuntu/home/user/script.ts:12', '//wsl.localhost/Ubuntu/home/user/script.ts'],
    ['report.ts%3A12', 'report.ts:12'],
  ])('decodes source locations while preserving encoded filename colons: %s', (href, expected) => {
    expect(localFilePathFromHref(href)).toBe(expected)
  })

  it.each([
    ['script.ts:12:3', 12],
    ['file:///home/user/script.py:128#section', 128],
    ['script.ts:0', undefined],
    ['script.ts:99999999999999999999', undefined],
    ['script.ts%3A12', undefined],
  ])('extracts valid source line numbers: %s', (href, expected) => {
    expect(localFileLineFromHref(href)).toBe(expected)
  })

  it('does not preview the current distro when a file URL names another distro', () => {
    render(<MarkdownView>{'[report](file://wsl.localhost/Debian/home/user/project/report.pdf)'}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: 'report' }))
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
    expect(ipcClient.invoke).toHaveBeenCalledWith('shell.openPath', { path: '//wsl.localhost/Debian/home/user/project/report.pdf' })
  })

  it('handles middle clicks instead of navigating to a file URL', () => {
    render(<MarkdownView>{markdown}</MarkdownView>)
    expect(fireEvent(screen.getByRole('link'), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))).toBe(false)
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('output/pdf/实验 报告.pdf')
  })

  it('resolves sibling and parent links from a previewed Markdown file', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '[sibling](./report.pdf) [parent](../output/report.pdf)' })
    render(<FilePreviewRouter workspaceRoot={root} relativePath="docs/readme.md" readText={readText} />)
    fireEvent.click(await screen.findByRole('link', { name: 'sibling' }))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('docs/report.pdf')
    fireEvent.click(screen.getByRole('link', { name: 'parent' }))
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('output/report.pdf')
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('updates relative links when the workspace changes', () => {
    render(<MarkdownView>{'[report](./report.pdf)'}</MarkdownView>)
    act(() => useUIStore.getState().setWorkspace('/another-project'))
    fireEvent.click(screen.getByRole('link'))
    expect(useUIStore.getState().workspaceFileToOpen).toEqual({ workspaceRoot: '/another-project', rel: 'report.pdf' })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('does not open relative links against the application directory without a workspace', () => {
    useUIStore.setState({ currentWorkspace: null })
    render(<MarkdownView>{'[report](./report.pdf)'}</MarkdownView>)
    expect(fireEvent.click(screen.getByRole('link'))).toBe(false)
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it.each([
    ['\\\\WSL.LOCALHOST\\ubuntu\\home\\user\\project', 'file://wsl.localhost/Ubuntu/home/user/project/report.pdf'],
    ['C:\\work', 'file:///c:/WORK/report.pdf'],
    ['C:\\', 'file:///mnt/c/report.pdf'],
    ['C:\\work', 'file:///mnt/c/work/report.pdf'],
    ['\\\\server\\share\\work', 'file://SERVER/share/WORK/report.pdf'],
    ['/', './report.pdf'],
  ])('recognizes workspace paths for %s', (workspaceRoot, href) => {
    useUIStore.setState({ currentWorkspace: workspaceRoot })
    render(<MarkdownView>{`[report](${href})`}</MarkdownView>)
    fireEvent.click(screen.getByRole('link'))
    expect(useUIStore.getState().workspaceFileToOpen).toEqual({ workspaceRoot, rel: 'report.pdf' })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it.each(['javascript:alert(1)', 'javascript:123', 'data:text/html,example', 'https://example.com/file', '//example.com/file', 'report%ZZ.pdf', 'report%00.pdf', 'report\t.pdf', '#section'])('rejects non-file or malformed destinations: %s', (href) => {
    expect(localFilePathFromHref(href, root)).toBeNull()
  })

  it('preserves encoded spaces and URL delimiters in the base directory and filename', () => {
    expect(localFilePathFromHref('report%23%3F%25.pdf#section', '/work/目录 #?%')).toBe('/work/目录 #?%/report#?%.pdf')
  })

  it.each([
    [root, '//wsl.localhost/Ubuntu/report.pdf'],
    ['\\\\server\\share\\work', '//server/share/report.pdf'],
  ])('keeps the share or WSL distro when parent links reach the filesystem root: %s', (base, expected) => {
    expect(localFilePathFromHref('../../../../../../report.pdf', base)).toBe(expected)
  })

  it('preserves case-sensitive Linux workspace boundaries', () => {
    render(<MarkdownView>{'[report](/home/user/Project/report.pdf)'}</MarkdownView>)
    fireEvent.click(screen.getByRole('link'))
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
    expect(ipcClient.invoke).toHaveBeenCalledWith('shell.openPath', { path: '/home/user/Project/report.pdf' })
  })

  it.each([false, true])('shows failed system opens (rejected: %s)', async (rejected) => {
    if (rejected) vi.mocked(ipcClient.invoke).mockRejectedValue(new Error('Open failed'))
    else vi.mocked(ipcClient.invoke).mockResolvedValue({ ok: false, error: 'File not found' })
    render(<MarkdownView>{'[report](/other/report.pdf)'}</MarkdownView>)
    await act(async () => fireEvent.click(screen.getByRole('link')))
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('leaves web links external and continues blocking executable URLs', () => {
    render(<MarkdownView>{'[website](https://example.com/report.pdf) [unsafe](javascript:alert%281%29)'}</MarkdownView>)
    expect(screen.getByRole('link', { name: 'website' })).toHaveAttribute('target', '_blank')
    expect(screen.getByText('unsafe')).toHaveAttribute('href', '')
    fireEvent.click(screen.getByRole('link', { name: 'website' }))
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
  })

  it('offers only opening, revealing, and copying from a keyboard accessible menu', async () => {
    render(<MarkdownView>{'[source](src/main.ts:12:3)'}</MarkdownView>)
    const link = screen.getByRole('link')
    fireEvent.keyDown(link, { key: 'F10', shiftKey: true })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open file', 'Reveal in folder', 'Copy path'])
    const open = screen.getByRole('menuitem', { name: 'Open file' })
    expect(open).toHaveFocus()
    fireEvent.keyDown(open, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Reveal in folder' })).toHaveFocus()
    await act(async () => { fireEvent.click(open) })
    expect(useUIStore.getState().workspaceFileToOpen).toEqual({ workspaceRoot: root, rel: 'src/main.ts', line: 12 })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(link).toHaveFocus()
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['output/pdf/%E5%AE%9E%E9%AA%8C%20%E6%8A%A5%E5%91%8A.pdf#page=1', '//wsl.localhost/Ubuntu/home/user/project/output/pdf/实验 报告.pdf'],
    ['file:///home/user/project/src/main.ts:12:3', '/home/user/project/src/main.ts'],
    ['file://wsl.localhost/Ubuntu/home/user/project/src/main.ts', '//wsl.localhost/Ubuntu/home/user/project/src/main.ts'],
    ['file:///C:/work/%E6%8A%A5%E5%91%8A.pdf', 'C:/work/报告.pdf'],
    ['/home/user/other/report.pdf', '/home/user/other/report.pdf'],
  ])('copies and reveals the decoded file path: %s', async (href, expectedPath) => {
    render(<MarkdownView>{`[file](${href})`}</MarkdownView>)
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' })) })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedPath)
    expect(toast.success).toHaveBeenCalledWith('Copied')
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in folder' })) })
    expect(ipcClient.invoke).toHaveBeenCalledExactlyOnceWith('shell.showItemInFolder', { path: expectedPath })
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows the file name and full path on hover, then opens the existing Files preview', async () => {
    vi.useFakeTimers()
    render(<MarkdownView>{'[source](src/main.ts:12)'}</MarkdownView>)
    fireEvent.mouseEnter(screen.getByRole('link'))
    await act(async () => { vi.advanceTimersByTime(800) })
    const card = screen.getByRole('dialog', { name: 'Link preview' })
    expect(card).toHaveTextContent('main.ts')
    expect(card).toHaveTextContent('//wsl.localhost/Ubuntu/home/user/project/src/main.ts')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open file' })) })
    expect(useUIStore.getState().workspaceFileToOpen?.line).toBe(12)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens files outside the workspace from the menu with the system viewer', async () => {
    render(<MarkdownView>{'[report](../other/report.pdf)'}</MarkdownView>)
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open file' })) })
    expect(ipcClient.invoke).toHaveBeenCalledExactlyOnceWith('shell.openPath', { path: '//wsl.localhost/Ubuntu/home/user/other/report.pdf' })
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
  })

  it('resolves menu paths from the previewed Markdown file directory', async () => {
    const readText = vi.fn().mockResolvedValue({ ok: true, content: '[sibling](./report.pdf) [parent](../output/report.pdf)' })
    render(<FilePreviewRouter workspaceRoot={root} relativePath="docs/readme.md" readText={readText} />)
    fireEvent.contextMenu(await screen.findByRole('link', { name: 'sibling' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' })) })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('//wsl.localhost/Ubuntu/home/user/project/docs/report.pdf')
    fireEvent.contextMenu(screen.getByRole('link', { name: 'parent' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open file' })) })
    expect(useUIStore.getState().workspaceFileToOpen?.rel).toBe('output/report.pdf')
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('does not reveal relative paths against the application directory without a workspace', async () => {
    useUIStore.setState({ currentWorkspace: null })
    render(<MarkdownView>{'[report](./report.pdf)'}</MarkdownView>)
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in folder' })) })
    expect(ipcClient.invoke).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it.each(['Open file', 'Reveal in folder'])('reports failures for %s', async (action) => {
    render(<MarkdownView>{'[report](/home/user/other/report.pdf)'}</MarkdownView>)
    for (const rejected of [false, true]) {
      if (rejected) vi.mocked(ipcClient.invoke).mockRejectedValueOnce(new Error('unavailable'))
      else vi.mocked(ipcClient.invoke).mockResolvedValueOnce({ ok: false })
      fireEvent.contextMenu(screen.getByRole('link'))
      await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: action })) })
      expect(toast.error).toHaveBeenLastCalledWith('Could not open path')
    }
    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('reports clipboard errors without opening the file', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    render(<MarkdownView>{markdown}</MarkdownView>)
    fireEvent.contextMenu(screen.getByRole('link'))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' })) })
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy the path. Try again.")
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('discards a pending preview when the workspace changes before mounting', () => {
    render(<MarkdownView>{markdown}</MarkdownView>)
    fireEvent.click(screen.getByRole('link', { name: '下载实验报告' }))
    act(() => useUIStore.getState().setWorkspace('/another-project'))
    expect(useUIStore.getState().workspaceFileToOpen).toBeNull()
  })
})
