import { app, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import log from 'electron-log'
import { errorMessage } from '@shared/error-message'
import type { AppUpdateDownloadProgress } from '@shared/app-update'
import { getMainWindow } from './window'

export const APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL = 'ipc:app-update-download-progress'

let downloadInFlight = false

function sendProgress(payload: AppUpdateDownloadProgress): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL, payload)
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s[\]]+/g, '_').slice(0, 180) || 'update.bin'
}

/**
 * Download release asset to temp and open it with the OS (starts installer / AppImage).
 * Non-blocking for UI via progress events; fails quietly if caller swallows errors.
 */
export async function downloadAndLaunchUpdate(opts: {
  url: string
  fileName: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (downloadInFlight) {
    return { ok: false, error: 'download_in_progress' }
  }
  const url = String(opts.url || '').trim()
  const fileName = safeFileName(String(opts.fileName || 'update.bin'))
  if (!url.startsWith('https://')) {
    return { ok: false, error: 'invalid_url' }
  }

  downloadInFlight = true
  const dir = join(app.getPath('temp'), 'pi-desktop-updates')
  const dest = join(dir, fileName)

  try {
    await mkdir(dir, { recursive: true })
    try {
      await unlink(dest)
    } catch {
      /* ok */
    }

    sendProgress({
      phase: 'downloading',
      receivedBytes: 0,
      totalBytes: 0,
      percent: 0,
      fileName,
    })

    const response = await fetch(url, {
      headers: { 'User-Agent': 'pi-desktop', Accept: 'application/octet-stream' },
      redirect: 'follow',
    })
    if (!response.ok || !response.body) {
      throw new Error(`download_http_${response.status}`)
    }

    const totalHeader = response.headers.get('content-length')
    const totalBytes = totalHeader ? Number(totalHeader) || 0 : 0
    let receivedBytes = 0

    const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
    nodeStream.on('data', (chunk: Buffer | string) => {
      const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      receivedBytes += size
      const percent =
        totalBytes > 0 ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : -1
      sendProgress({
        phase: 'downloading',
        receivedBytes,
        totalBytes,
        percent,
        fileName,
      })
    })

    await pipeline(nodeStream, createWriteStream(dest))

    sendProgress({
      phase: 'launching',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName,
    })

    const openError = await shell.openPath(dest)
    if (openError) {
      throw new Error(openError)
    }

    sendProgress({
      phase: 'done',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName,
    })
    log.info('[Updater] launched installer:', dest)
    return { ok: true, path: dest }
  } catch (error: unknown) {
    const message = error instanceof Error ? errorMessage(error) : errorMessage(error)
    log.warn('[Updater] download/launch failed:', message)
    sendProgress({
      phase: 'error',
      receivedBytes: 0,
      totalBytes: 0,
      percent: -1,
      fileName,
      error: message,
    })
    return { ok: false, error: message }
  } finally {
    downloadInFlight = false
  }
}
