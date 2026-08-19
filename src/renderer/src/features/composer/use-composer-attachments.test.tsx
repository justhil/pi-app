import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useComposerAttachments } from './use-composer-attachments'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(async () => ({ path: 'C:/tmp/clip.png' })) },
}))

function setup() {
  const editorRef = { current: null as HTMLDivElement | null }
  const dragDepth = { current: 0 }
  const setIsDragActive = vi.fn()
  const updateFromEditor = vi.fn()
  const { result } = renderHook(() =>
    useComposerAttachments({
      editorRef,
      updateFromEditor,
      canCompose: true,
      canSendMessages: true,
      currentWorkspace: 'C:/ws',
      ephemeralSandboxDraft: false,
      setIsDragActive,
      dragDepth,
    }),
  )
  return { handlePaste: result.current.handlePaste, editorRef, updateFromEditor }
}

function pasteEvent(clipboardData: unknown) {
  return {
    clipboardData,
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent
}

function textClipboardData(plain: string, html = '') {
  return {
    items: [],
    files: [],
    getData: (type: string) => {
      if (type === 'text/plain') return plain
      if (type === 'text/html') return html
      return ''
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
  delete window.piDesktop
})

/** jsdom 没有 Electron preload：让 getPathForFile 返回真实路径，与桌面端一致。 */
function mockPiDesktopPath(path: string) {
  Object.defineProperty(window, 'piDesktop', {
    value: { getPathForFile: () => path },
    configurable: true,
  })
}

describe('useComposerAttachments handlePaste', () => {
  it('lets a plain-text paste through natively (no preventDefault) so undo stays intact', () => {
    const { handlePaste } = setup()
    const ev = pasteEvent(textClipboardData('hello world'))

    handlePaste(ev)

    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('lets a rich (html+plain) paste through natively', () => {
    const { handlePaste } = setup()
    const ev = pasteEvent(textClipboardData('hello', '<div>hello</div>'))

    handlePaste(ev)

    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('lets an html-only paste through natively', () => {
    const { handlePaste } = setup()
    const ev = pasteEvent(textClipboardData('   ', '<p>rich</p>'))

    handlePaste(ev)

    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('still intercepts a file paste (attachment chips are programmatic)', () => {
    mockPiDesktopPath('C:/files/a.ts')
    const { handlePaste } = setup()
    const file = new File(['x'], 'a.ts', { type: 'text/plain' })
    const ev = pasteEvent({
      items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }],
      files: [file],
      getData: (type: string) => (type === 'text/plain' ? '' : ''),
    })

    handlePaste(ev)

    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('still intercepts a clipboard image paste', () => {
    mockPiDesktopPath('C:/files/shot.png')
    const { handlePaste } = setup()
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    const ev = pasteEvent({
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [file],
      getData: (type: string) => (type === 'text/plain' ? '' : ''),
    })

    handlePaste(ev)

    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('still intercepts an html data-url image paste', () => {
    const { handlePaste } = setup()
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" />'
    const ev = pasteEvent(textClipboardData('', html))

    handlePaste(ev)

    expect(ev.preventDefault).toHaveBeenCalled()
  })
})
