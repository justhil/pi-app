import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentChip } from '../attachment-chip'
import { ImageLightbox } from '@renderer/components/ui/image-lightbox'
import { useComposerAttachments } from '../use-composer-attachments'
import {
  rememberTransientComposerDraft,
  rememberTransientComposerImages,
  readTransientComposerImages,
  clearTransientComposerDraft,
} from '../composer-transient-draft'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_method: string, _request?: unknown) => ({ path: 'C:/tmp/pi-clipboard-x.png' })),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string, request?: unknown) => mocks.invoke(method, request) },
}))

vi.mock('./delayed-tooltip', () => ({
  DelayedTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  hideAllDelayedTooltips: vi.fn(),
  wireDelayedTooltip: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const DATA_URL = 'data:image/png;base64,eA=='

describe('AttachmentChip staged image thumbnail', () => {
  it('renders the image instead of the file icon and opens the preview on click', () => {
    const onPreview = vi.fn()
    render(
      <AttachmentChip
        attachment={{ path: 'C:/tmp/pi-clipboard-a.png', name: 'clipboard-image-1.png', kind: 'image' }}
        previewSrc={DATA_URL}
        onPreview={onPreview}
      />,
    )

    const img = screen.getByRole('img', { name: 'clipboard-image-1.png' })
    expect(img.getAttribute('src')).toBe(DATA_URL)

    fireEvent.click(screen.getByRole('button', { name: 'composer:previewImage' }))
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('removes without opening the preview', () => {
    const onPreview = vi.fn()
    const onRemove = vi.fn()
    render(
      <AttachmentChip
        attachment={{ path: 'C:/tmp/pi-clipboard-a.png', name: 'clipboard-image-1.png', kind: 'image' }}
        previewSrc={DATA_URL}
        onPreview={onPreview}
        onRemove={onRemove}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'composer:removeFile' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('falls back to the icon when no thumbnail is available', () => {
    render(
      <AttachmentChip
        attachment={{ path: 'C:/outside/shot.png', name: 'shot.png', kind: 'image' }}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull()
    expect(screen.getByText('shot.png')).toBeTruthy()
  })

  it('uses the 64px tile with a theme-token remove badge', () => {
    render(
      <AttachmentChip
        attachment={{ path: 'C:/tmp/pi-clipboard-b.png', name: 'b.png', kind: 'image' }}
        previewSrc={DATA_URL}
        onPreview={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const tile = screen.getByRole('img', { name: 'b.png' }).closest('.attachment-chip') as HTMLElement
    expect(tile.className).toContain('h-16')
    expect(tile.className).toContain('w-16')
    // Badge must stay legible over any picture, so it may not inherit the image's own colours.
    expect(tile.className).not.toContain('overflow-hidden')

    const badge = screen.getByRole('button', { name: 'composer:removeFile' })
    expect(badge.className).toContain('bg-[var(--bg-1)]')
    expect(badge.className).toContain('border-border')
    expect(badge.className).not.toContain('text-white')
    expect(badge.className).not.toContain('bg-black')
  })
})

describe('ImageLightbox', () => {
  it('renders nothing without a source', () => {
    const { container } = render(<ImageLightbox src={null} onClose={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes on Escape and on backdrop click', () => {
    const onClose = vi.fn()
    render(<ImageLightbox src={DATA_URL} alt="shot.png" onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'shot.png' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('styles the close button with theme tokens, not a fixed black/white pair', () => {
    render(<ImageLightbox src={DATA_URL} alt="shot.png" onClose={vi.fn()} />)

    const close = screen.getByRole('button', { name: 'composer:closePreview' })
    expect(close.className).toContain('bg-background/95')
    expect(close.className).toContain('text-foreground')
    expect(close.className).toContain('border-border')
    expect(close.className).not.toContain('text-white')
    expect(close.className).not.toContain('bg-black')
  })
})

describe('transient composer images', () => {
  it('remembers images per draft key and clears them with the draft', () => {
    const images = [{ path: 'C:/tmp/a.png', name: 'a.png', mimeType: 'image/png', dataUrl: DATA_URL }]
    rememberTransientComposerImages('draft-1', images)
    expect(readTransientComposerImages('draft-1')).toEqual(images)

    rememberTransientComposerImages('draft-1', [])
    expect(readTransientComposerImages('draft-1')).toBeNull()

    rememberTransientComposerImages('draft-1', images)
    clearTransientComposerDraft('draft-1')
    expect(readTransientComposerImages('draft-1')).toBeNull()
  })

  it('should_preserve_staged_images_when_text_draft_is_cleared_with_empty_segments', () => {
    const images = [{ path: 'C:/tmp/a.png', name: 'a.png', mimeType: 'image/png', dataUrl: DATA_URL }]
    rememberTransientComposerImages('draft-1', images)
    rememberTransientComposerDraft('draft-1', [])
    expect(readTransientComposerImages('draft-1')).toEqual(images)
    clearTransientComposerDraft('draft-1')
  })
})

describe('useComposerAttachments image paste', () => {
  function setup() {
    const editorRef = { current: document.createElement('div') }
    editorRef.current.contentEditable = 'true'
    document.body.appendChild(editorRef.current)
    const stageImage = vi.fn()
    const { result } = renderHook(() =>
      useComposerAttachments({
        editorRef,
        updateFromEditor: vi.fn(),
        canCompose: true,
        canSendMessages: true,
        currentWorkspace: 'C:/ws',
        ephemeralSandboxDraft: false,
        setIsDragActive: vi.fn(),
        dragDepth: { current: 0 },
        stageImage,
      }),
    )
    return {
      handlePaste: result.current.handlePaste,
      handleDrop: result.current.handleDrop,
      stageImage,
      editor: editorRef.current,
    }
  }

  it('stages a screenshot paste with a thumbnail and inserts an inline placeholder chip', async () => {
    const { handlePaste, stageImage, editor } = setup()
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" />'

    await act(async () => {
      handlePaste({
        clipboardData: {
          items: [],
          files: [],
          getData: (type: string) => (type === 'text/html' ? html : ''),
        },
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent)
    })

    expect(stageImage).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'C:/tmp/pi-clipboard-x.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    )
    const chip = editor.querySelector('.rich-attachment-chip') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip?.dataset.attachmentPath).toBe('C:/tmp/pi-clipboard-x.png')
  })

  it('inserts an inline placeholder chip and stages a thumbnail when dropping an image file', () => {
    const { handleDrop, stageImage, editor } = setup()
    const file = Object.assign(new File(['img'], 'dropped.png', { type: 'image/png' }), {
      path: 'C:/ws/dropped.png',
    })

    act(() => {
      handleDrop({
        dataTransfer: {
          types: ['Files'],
          files: [file],
          getData: () => '',
        },
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent)
    })

    expect(stageImage).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'C:/ws/dropped.png',
        name: 'dropped.png',
        mimeType: 'image/png',
      }),
    )
    const chip = editor.querySelector('.rich-attachment-chip') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip?.dataset.attachmentPath).toBe('C:/ws/dropped.png')
  })
})
