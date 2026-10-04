// Downloads of the built-in browser. With aria2 available (PATH or the configured path) a
// download runs as a multi-connection aria2c process carrying the page's cookies, user agent
// and referer; otherwise, or when aria2 fails before receiving data, Electron downloads it.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { shell, type DownloadItem, type Session, type WebContents } from 'electron'
import type { BrowserDownloadInfo, BrowserDownloader, BrowserEvent } from '@shared/browser-types'
import { aria2InputFile, parseReadout } from './aria2-readout'

export interface DownloaderSettings {
  downloader: BrowserDownloader
  aria2Path: string
  connections: number
}

interface Entry {
  info: BrowserDownloadInfo
  proc?: ChildProcess
  item?: DownloadItem
  lastEmit: number
  lastBytes: number
  lastAt: number
}

const EXE = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The aria2c to use: the configured path if valid, else the first on PATH. */
export function findAria2(configured: string): string | null {
  if (configured) return isExecutable(configured) ? configured : null
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, EXE)
    if (existsSync(p) && isExecutable(p)) return p
  }
  return null
}

export function aria2Version(path: string): string | null {
  try {
    const r = spawnSync(path, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
    return /aria2 version ([\d.]+)/.exec(r.stdout ?? '')?.[1] ?? null
  } catch {
    return null
  }
}

export class DownloadManager {
  private readonly entries = new Map<string, Entry>()
  /** URLs handed back to Electron after aria2 failed: the next will-download keeps them. */
  private readonly electronOnly = new Set<string>()

  constructor(
    private readonly emit: (event: BrowserEvent) => void,
    private readonly settings: () => DownloaderSettings,
  ) {}

  list(): BrowserDownloadInfo[] {
    return [...this.entries.values()].map((e) => e.info).sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * Session will-download, decided synchronously: Electron needs either a save path or a
   * prevented default before the handler returns.
   */
  onWillDownload(event: { preventDefault(): void }, ses: Session, item: DownloadItem, wc: WebContents | undefined, savePath: string): void {
    const url = item.getURL()
    const s = this.settings()
    const aria2 = s.downloader === 'auto' && /^https?:/i.test(url) && !this.electronOnly.delete(url) ? findAria2(s.aria2Path) : null
    if (!aria2) return this.trackElectron(item, savePath, url)
    // aria2 takes over: Electron must not write anything.
    event.preventDefault()
    const referer = wc && !wc.isDestroyed() ? wc.getURL() : ''
    void ses.cookies
      .get({ url })
      .catch(() => [])
      .then((cookies) => {
        const headers = { 'User-Agent': ses.getUserAgent(), Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), Referer: referer }
        this.startAria2(ses, aria2, url, savePath, headers, Math.max(1, Math.min(16, s.connections)))
      })
  }

  private add(info: BrowserDownloadInfo, extra: Partial<Entry> = {}): Entry {
    const entry: Entry = { info, lastEmit: 0, lastBytes: 0, lastAt: Date.now(), ...extra }
    this.entries.set(info.id, entry)
    this.emit({ type: 'download-updated', download: info })
    return entry
  }

  private update(entry: Entry, patch: Partial<BrowserDownloadInfo>, force = false): void {
    entry.info = { ...entry.info, ...patch }
    const now = Date.now()
    if (!force && now - entry.lastEmit < 500) return
    entry.lastEmit = now
    this.emit({ type: 'download-updated', download: entry.info })
    if (patch.state === 'completed' || patch.state === 'cancelled' || patch.state === 'failed') {
      this.emit({ type: 'download', fileName: entry.info.fileName, savePath: entry.info.savePath, state: patch.state === 'completed' ? 'completed' : patch.state === 'cancelled' ? 'cancelled' : 'interrupted' })
    }
  }

  private startAria2(ses: Session, bin: string, url: string, savePath: string, headers: Record<string, string>, connections: number): void {
    const dir = dirname(savePath)
    mkdirSync(dir, { recursive: true })
    const entry = this.add({ id: randomUUID(), url, fileName: basename(savePath), savePath, received: 0, total: 0, speed: 0, state: 'progressing', via: 'aria2', startedAt: Date.now() })
    const args = [
      '--input-file=-', `--max-connection-per-server=${connections}`, `--split=${connections}`, '--min-split-size=1M',
      '--file-allocation=none', '--continue=true', '--auto-file-renaming=false', '--allow-overwrite=false',
      '--summary-interval=1', '--console-log-level=error', '--download-result=hide', '--enable-color=false',
      '--show-console-readout=true', '--max-tries=3', '--retry-wait=2',
    ]
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    entry.proc = proc
    proc.stdin?.end(aria2InputFile({ url, dir, out: entry.info.fileName, headers }))
    const onData = (chunk: Buffer) => {
      const p = parseReadout(chunk.toString())
      if (!p) return
      this.update(entry, { received: p.received, total: p.total, speed: p.speed })
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', () => undefined)
    proc.on('error', () => this.fallback(ses, entry, 'aria2 could not start'))
    proc.on('exit', (code) => {
      entry.proc = undefined
      if (entry.info.state !== 'progressing') return
      if (code === 0) {
        // Fast downloads may finish before aria2 prints any readout: take the size from disk.
        let size = Math.max(entry.info.received, entry.info.total)
        try {
          size = statSync(entry.info.savePath).size
        } catch {
          // keep the last reported size
        }
        this.update(entry, { state: 'completed', received: size, total: size, speed: 0 }, true)
      } else if (entry.info.received === 0) {
        this.fallback(ses, entry, `aria2 exited with code ${code}`)
      } else {
        this.update(entry, { state: 'failed', speed: 0, error: `aria2 exited with code ${code}` }, true)
      }
    })
  }

  /** aria2 failed before receiving data: retry the same URL with Electron's downloader. */
  private fallback(ses: Session, entry: Entry, reason: string): void {
    if (entry.info.state !== 'progressing') return
    this.entries.delete(entry.info.id)
    this.emit({ type: 'download-updated', download: { ...entry.info, state: 'cancelled', error: reason } })
    this.electronOnly.add(entry.info.url)
    ses.downloadURL(entry.info.url)
  }

  private trackElectron(item: DownloadItem, savePath: string, url: string): void {
    item.setSavePath(savePath)
    const entry = this.add({ id: randomUUID(), url, fileName: basename(savePath), savePath, received: 0, total: item.getTotalBytes(), speed: 0, state: 'progressing', via: 'electron', startedAt: Date.now() }, { item })
    item.on('updated', () => {
      const now = Date.now()
      const received = item.getReceivedBytes()
      const dt = (now - entry.lastAt) / 1000
      const speed = dt >= 0.5 ? Math.max(0, Math.round((received - entry.lastBytes) / dt)) : entry.info.speed
      if (dt >= 0.5) {
        entry.lastAt = now
        entry.lastBytes = received
      }
      this.update(entry, { received, total: item.getTotalBytes(), speed })
    })
    item.once('done', (_e, state) => {
      entry.item = undefined
      this.update(entry, { state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed', speed: 0, received: item.getReceivedBytes() }, true)
    })
  }

  cancel(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.info.state !== 'progressing') return
    if (entry.item) entry.item.cancel()
    if (entry.proc) {
      entry.proc.kill()
      // A cancelled aria2 download leaves the partial file and its .aria2 control file.
      for (const p of [entry.info.savePath, `${entry.info.savePath}.aria2`]) rmSync(p, { force: true })
      this.update(entry, { state: 'cancelled', speed: 0 }, true)
    }
  }

  reveal(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.info.state === 'completed' && existsSync(entry.info.savePath)) shell.showItemInFolder(entry.info.savePath)
    else void shell.openPath(dirname(entry.info.savePath))
  }

  clearFinished(): void {
    for (const [id, e] of this.entries) if (e.info.state !== 'progressing') this.entries.delete(id)
  }

  shutdown(): void {
    for (const e of this.entries.values()) e.proc?.kill()
  }
}
