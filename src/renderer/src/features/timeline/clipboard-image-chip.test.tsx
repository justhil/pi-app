import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardImageChip } from './clipboard-image-chip'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_method: string, _request?: unknown): Promise<unknown> => ({ ok: false, error: 'not_found' })),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string, request?: unknown) => mocks.invoke(method, request) },
}))

vi.mock('@renderer/features/composer/delayed-tooltip', () => ({
  DelayedTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  hideAllDelayedTooltips: vi.fn(),
  wireDelayedTooltip: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const DATA_URL = 'data:image/png;base64,eA=='

describe('ClipboardImageChip', () => {
  it('shows the picture once the bytes come back', async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: true, dataUrl: DATA_URL })

    render(<ClipboardImageChip path="C:/tmp/pi-clipboard-thumb.png" name="shot.png" />)

    const img = await screen.findByRole('img', { name: 'shot.png' })
    expect(img.getAttribute('src')).toBe(DATA_URL)
    expect(mocks.invoke).toHaveBeenCalledWith('clipboard.readTempImage', { path: 'C:/tmp/pi-clipboard-thumb.png' })
  })

  it('keeps the file chip when the temp image is gone', async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: false, error: 'not_found' })

    render(<ClipboardImageChip path="C:/tmp/pi-clipboard-gone.png" name="gone.png" />)

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('img', { name: 'gone.png' })).toBeNull()
    expect(screen.getByText('gone.png')).toBeTruthy()
  })

  it('opens the preview from the bubble and reads each image once', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, dataUrl: DATA_URL })
    const path = 'C:/tmp/pi-clipboard-preview.png'

    const first = render(<ClipboardImageChip path={path} name="shot.png" />)
    await screen.findByRole('img', { name: 'shot.png' })
    fireEvent.click(screen.getByRole('button', { name: 'composer:previewImage' }))
    expect(screen.getByRole('dialog', { name: 'shot.png' })).toBeTruthy()
    first.unmount()

    render(<ClipboardImageChip path={path} name="shot.png" />)
    await screen.findByRole('img', { name: 'shot.png' })
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
})
