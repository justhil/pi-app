import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electron = vi.hoisted(() => {
  const window = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  }
  return {
    getPath: vi.fn(() => join(tmpdir(), 'pi-desktop-update-download-test')),
    fetch: vi.fn(),
    openPath: vi.fn(),
    getMainWindow: vi.fn(() => window),
    window,
  }
})

vi.mock('electron', () => ({
  app: { getPath: electron.getPath },
  net: { fetch: electron.fetch },
  shell: { openPath: electron.openPath },
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}))

vi.mock('./window', () => ({ getMainWindow: electron.getMainWindow }))

import { downloadAndLaunchUpdate } from './app-update-download'

const url = 'https://example.test/pi-desktop-update.exe'
const fileName = 'pi-desktop-update-test.exe'

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-length': String(Buffer.byteLength(body)) },
  })
}

describe('downloadAndLaunchUpdate network wiring', () => {
  beforeEach(async () => {
    electron.fetch.mockReset()
    electron.openPath.mockReset()
    electron.openPath.mockResolvedValue('')
    electron.getMainWindow.mockClear()
    electron.window.webContents.send.mockReset()
    await rm(electron.getPath(), { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(electron.getPath(), { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('returns a stable error for a non-2xx download response', async () => {
    electron.fetch.mockResolvedValue(response('server error', 503))

    const result = await downloadAndLaunchUpdate({ url, fileName })

    expect(result).toEqual({ ok: false, error: 'download_http_503' })
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('returns a stable error when the download response has no body', async () => {
    electron.fetch.mockResolvedValue(new Response(null, { status: 200 }))

    const result = await downloadAndLaunchUpdate({ url, fileName })

    expect(result).toEqual({ ok: false, error: 'download_http_200' })
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('allows a retry after a failed download clears in-flight state', async () => {
    electron.fetch
      .mockResolvedValueOnce(response('server error', 503))
      .mockResolvedValueOnce(response('installer-bytes'))

    const failed = await downloadAndLaunchUpdate({ url, fileName })
    const retried = await downloadAndLaunchUpdate({ url, fileName })

    expect(failed).toEqual({ ok: false, error: 'download_http_503' })
    expect(retried.ok).toBe(true)
    expect(electron.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns shell.openPath failures and permits a retry', async () => {
    electron.fetch
      .mockResolvedValueOnce(response('installer-bytes'))
      .mockResolvedValueOnce(response('installer-bytes-retry'))
    electron.openPath.mockResolvedValueOnce('installer launch failed').mockResolvedValueOnce('')

    const failed = await downloadAndLaunchUpdate({ url, fileName })
    const retried = await downloadAndLaunchUpdate({ url, fileName })

    expect(failed).toEqual({ ok: false, error: 'installer launch failed' })
    expect(retried.ok).toBe(true)
    expect(electron.openPath).toHaveBeenCalledTimes(2)
  })

  it('uses Electron net.fetch while preserving download progress and output', async () => {
    const globalFetch = vi.fn(() => {
      throw new Error('Node global fetch must not be used for updates')
    })
    vi.stubGlobal('fetch', globalFetch)
    electron.fetch.mockResolvedValue(response('installer-bytes'))

    const result = await downloadAndLaunchUpdate({ url, fileName })

    expect(result.ok).toBe(true)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(electron.fetch).toHaveBeenCalledTimes(1)
    expect(electron.fetch).toHaveBeenCalledWith(url, {
      headers: { 'User-Agent': 'pi-desktop', Accept: 'application/octet-stream' },
      redirect: 'follow',
    })
    expect(electron.openPath).toHaveBeenCalledWith(result.path)
    await expect(readFile(result.path!, 'utf8')).resolves.toBe('installer-bytes')
    const sent = electron.window.webContents.send.mock.calls
    expect(sent.map((call) => (call[1] as { phase: string }).phase)).toEqual([
      'downloading',
      'downloading',
      'launching',
      'done',
    ])
    expect(sent.at(-1)?.[1]).toMatchObject({ phase: 'done', percent: 100 })
  })
})
