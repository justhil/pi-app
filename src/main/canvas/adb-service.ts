import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import {
  CANVAS_EVENT_CHANNEL,
  type AdbDeviceInfo,
  type CanvasAdbFrameEvent,
  type CanvasAdbStatusEvent,
} from '@shared/canvas-types'
import { getMainWindow } from '../window'

const execFileAsync = promisify(execFile)

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,128}$/
const KEYEVENT_RE = /^(?:\d{1,3}|KEYCODE_[A-Z0-9_]{1,40})$/
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_SCREENCAP_BYTES = 25 * 1024 * 1024

export function isValidAdbSerial(serial: string): boolean {
  return SERIAL_RE.test(serial)
}

export function isValidKeyevent(keyCode: string): boolean {
  return KEYEVENT_RE.test(keyCode)
}

/** Parse PNG dimensions directly from the 24-byte PNG signature + IHDR chunk (zero extra deps). */
export function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width <= 0 || height <= 0 || width > 16_384 || height > 16_384) return null
  return { width, height }
}

/** Parse `adb devices -l` output into structured device records. */
export function parseAdbDevicesOutput(stdout: string): AdbDeviceInfo[] {
  const devices: AdbDeviceInfo[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const [serial, state, ...rest] = parts
    if (!serial || !isValidAdbSerial(serial)) continue
    const kv: Record<string, string> = {}
    for (const token of rest) {
      const idx = token.indexOf(':')
      if (idx > 0) kv[token.slice(0, idx)] = token.slice(idx + 1)
    }
    devices.push({
      serial,
      state,
      model: kv.model ? kv.model.replace(/_/g, ' ') : undefined,
      product: kv.product,
      device: kv.device,
      transportId: kv.transport_id,
    })
  }
  return devices
}

export function parseWmSizeOutput(stdout: string): { width: number; height: number } | undefined {
  const override = /Override size:\s*(\d+)x(\d+)/i.exec(stdout)
  const physical = /Physical size:\s*(\d+)x(\d+)/i.exec(stdout)
  const match = override ?? physical
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? { width, height } : undefined
}

export function parseBatteryLevel(stdout: string): number | undefined {
  const match = /^\s*level:\s*(\d+)/im.exec(stdout)
  if (!match) return undefined
  const n = Number(match[1])
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined
}

export function parseForegroundApp(stdout: string): string | undefined {
  const focus = /mCurrentFocus=Window\{[^\n]*?\s([a-zA-Z0-9_.]+)\/[^\s}]+\}/i.exec(stdout)
  if (focus?.[1]) return focus[1]
  const resumed = /topResumedActivity=ActivityRecord\{[^\n]*?\s([a-zA-Z0-9_.]+)\//i.exec(stdout)
  return resumed?.[1]
}

/** Escape ASCII text for `adb shell input text`. Rejects non-ASCII because Android input text drops UTF-8. */
export function encodeAdbInputText(input: string): { ok: true; encoded: string } | { ok: false; error: string } {
  if (!input) return { ok: false, error: 'empty_text' }
  if (/[^\x20-\x7e]/.test(input)) {
    return { ok: false, error: 'adb_text_ascii_only' }
  }
  // Escape shell-significant ASCII characters so `adb shell input text` never interprets them.
  const escaped = input.replace(/[\\'"`$&|;<>()[\]{}*?!#~]/g, (ch) => `\\${ch}`).replace(/ /g, '%s')
  return { ok: true, encoded: escaped }
}

async function runAdbText(args: string[], timeoutMs = 4_000): Promise<string> {
  const { stdout } = await execFileAsync('adb', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout
}

async function runAdbScreencap(serial: string, timeoutMs = 8_000): Promise<Buffer> {
  const { stdout } = await execFileAsync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_SCREENCAP_BYTES,
  })
  return stdout
}

async function probeDeviceMeta(device: AdbDeviceInfo): Promise<AdbDeviceInfo> {
  if (device.state !== 'device') return device
  const [sizeOut, batteryOut, windowOut] = await Promise.all([
    runAdbText(['-s', device.serial, 'shell', 'wm', 'size'], 3_000).catch(() => ''),
    runAdbText(['-s', device.serial, 'shell', 'dumpsys', 'battery'], 3_000).catch(() => ''),
    runAdbText(['-s', device.serial, 'shell', 'dumpsys', 'window', 'displays'], 3_000).catch(() => ''),
  ])
  return {
    ...device,
    resolution: parseWmSizeOutput(sizeOut) ?? device.resolution,
    battery: parseBatteryLevel(batteryOut),
    activeApp: parseForegroundApp(windowOut),
  }
}

export async function listAdbDevices(): Promise<{
  ok: boolean
  available: boolean
  devices: AdbDeviceInfo[]
  error?: string
}> {
  try {
    const out = await runAdbText(['devices', '-l'], 5_000)
    const base = parseAdbDevicesOutput(out)
    const enriched = await Promise.all(base.map((d) => probeDeviceMeta(d)))
    return { ok: true, available: true, devices: enriched }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return { ok: false, available: false, devices: [], error: 'adb_not_found' }
    }
    return {
      ok: false,
      available: true,
      devices: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function sendCanvasEvent(event: CanvasAdbFrameEvent | CanvasAdbStatusEvent): boolean {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  win.webContents.send(CANVAS_EVENT_CHANNEL, event)
  return true
}

interface StreamEntry {
  serial: string
  intervalMs: number
  stopped: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastHash: string
  lastEmitAt: number
  frameTimestamps: number[]
  consecutiveErrors: number
  inFlight: boolean
}

const activeStreams = new Map<string, StreamEntry>()

function computeFps(timestamps: number[], now: number): number {
  const cutoff = now - 2500
  while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift()
  if (timestamps.length < 2) return timestamps.length
  const spanSec = Math.max(0.5, (now - timestamps[0]) / 1000)
  return Number((timestamps.length / spanSec).toFixed(1))
}

function scheduleNextTick(entry: StreamEntry, delayMs: number): void {
  if (entry.stopped) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = null
    void pollStreamFrame(entry)
  }, delayMs)
}

async function pollStreamFrame(entry: StreamEntry): Promise<void> {
  if (entry.stopped || entry.inFlight) return
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    stopAdbStream(entry.serial)
    return
  }
  // Automatically suspend screencap polling when the window is minimized or hidden to save CPU/battery.
  if (win.isMinimized() || !win.isVisible()) {
    scheduleNextTick(entry, 1_000)
    return
  }

  entry.inFlight = true
  const startedAt = Date.now()
  try {
    const buf = await runAdbScreencap(entry.serial, 8_000)
    if (entry.stopped) return
    const dims = parsePngDimensions(buf)
    if (!dims) throw new Error('invalid_png_frame')

    const now = Date.now()
    const hash = createHash('sha1').update(buf).digest('base64')
    entry.consecutiveErrors = 0
    if (hash !== entry.lastHash || now - entry.lastEmitAt > 4_000) {
      entry.lastHash = hash
      entry.lastEmitAt = now
      entry.frameTimestamps.push(now)
      const fps = computeFps(entry.frameTimestamps, now)
      sendCanvasEvent({
        type: 'canvas-adb-frame',
        serial: entry.serial,
        frameDataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        width: dims.width,
        height: dims.height,
        fps,
        at: now,
      })
    }
    const elapsed = Date.now() - startedAt
    const waitMs = Math.max(60, entry.intervalMs - elapsed)
    scheduleNextTick(entry, waitMs)
  } catch (error) {
    if (entry.stopped) return
    entry.consecutiveErrors += 1
    const msg =
      (error as NodeJS.ErrnoException)?.code === 'ENOENT'
        ? 'adb_not_found'
        : error instanceof Error
          ? error.message
          : String(error)
    if (entry.consecutiveErrors >= 2 || msg === 'adb_not_found') {
      sendCanvasEvent({
        type: 'canvas-adb-status',
        serial: entry.serial,
        status: 'error',
        error: msg,
      })
    }
    if (msg === 'adb_not_found') {
      stopAdbStream(entry.serial)
      return
    }
    const backoffMs = Math.min(4_000, entry.intervalMs * Math.min(8, entry.consecutiveErrors + 1))
    scheduleNextTick(entry, backoffMs)
  } finally {
    entry.inFlight = false
  }
}

export async function startAdbStream(
  serial: string,
  intervalMs = 350,
): Promise<{ ok: boolean; error?: string; device?: AdbDeviceInfo }> {
  if (!isValidAdbSerial(serial)) return { ok: false, error: 'invalid_serial' }
  const clampedInterval = Math.min(Math.max(Math.round(intervalMs), 180), 3_000)

  const existing = activeStreams.get(serial)
  if (existing && !existing.stopped) {
    existing.intervalMs = clampedInterval
    existing.lastHash = ''
    scheduleNextTick(existing, 20)
    return { ok: true }
  }

  const entry: StreamEntry = {
    serial,
    intervalMs: clampedInterval,
    stopped: false,
    timer: null,
    lastHash: '',
    lastEmitAt: 0,
    frameTimestamps: [],
    consecutiveErrors: 0,
    inFlight: false,
  }
  activeStreams.set(serial, entry)
  sendCanvasEvent({ type: 'canvas-adb-status', serial, status: 'connecting' })

  const probed = await probeDeviceMeta({ serial, state: 'device' }).catch(() => undefined)
  if (entry.stopped) return { ok: false, error: 'stream_stopped' }
  if (probed) {
    sendCanvasEvent({ type: 'canvas-adb-status', serial, status: 'connecting', device: probed })
  }
  void pollStreamFrame(entry)
  return { ok: true, device: probed }
}

export function stopAdbStream(serial: string): boolean {
  const entry = activeStreams.get(serial)
  if (!entry) return false
  entry.stopped = true
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  activeStreams.delete(serial)
  sendCanvasEvent({ type: 'canvas-adb-status', serial, status: 'paused' })
  return true
}

export function stopAllAdbStreams(): void {
  for (const serial of [...activeStreams.keys()]) {
    const entry = activeStreams.get(serial)
    if (!entry) continue
    entry.stopped = true
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    activeStreams.delete(serial)
  }
}

export type AdbInputRequest =
  | { serial: string; action: 'tap'; x: number; y: number }
  | { serial: string; action: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { serial: string; action: 'keyevent'; keyCode: string }
  | { serial: string; action: 'text'; text: string }
  | { serial: string; action: 'capture' }

export async function sendAdbInput(req: AdbInputRequest): Promise<{
  ok: boolean
  cmd?: string
  frameDataUrl?: string
  width?: number
  height?: number
  error?: string
}> {
  if (!isValidAdbSerial(req.serial)) return { ok: false, error: 'invalid_serial' }

  try {
    if (req.action === 'capture') {
      const buf = await runAdbScreencap(req.serial, 8_000)
      const dims = parsePngDimensions(buf)
      if (!dims) return { ok: false, error: 'invalid_png_frame' }
      const frameDataUrl = `data:image/png;base64,${buf.toString('base64')}`
      sendCanvasEvent({
        type: 'canvas-adb-frame',
        serial: req.serial,
        frameDataUrl,
        width: dims.width,
        height: dims.height,
        at: Date.now(),
      })
      return { ok: true, frameDataUrl, width: dims.width, height: dims.height }
    }

    let args: string[]
    if (req.action === 'tap') {
      const x = Math.max(0, Math.round(req.x))
      const y = Math.max(0, Math.round(req.y))
      args = ['-s', req.serial, 'shell', 'input', 'tap', String(x), String(y)]
    } else if (req.action === 'swipe') {
      const x1 = Math.max(0, Math.round(req.x1))
      const y1 = Math.max(0, Math.round(req.y1))
      const x2 = Math.max(0, Math.round(req.x2))
      const y2 = Math.max(0, Math.round(req.y2))
      const dur = Math.min(Math.max(Math.round(req.durationMs ?? 240), 50), 3_000)
      args = ['-s', req.serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(dur)]
    } else if (req.action === 'keyevent') {
      if (!isValidKeyevent(req.keyCode)) return { ok: false, error: 'invalid_keyevent' }
      args = ['-s', req.serial, 'shell', 'input', 'keyevent', req.keyCode]
    } else {
      const enc = encodeAdbInputText(req.text)
      if (!enc.ok) return { ok: false, error: enc.error }
      args = ['-s', req.serial, 'shell', 'input', 'text', enc.encoded]
    }

    await runAdbText(args, 5_000)
    // Trigger an immediate follow-up refresh when streaming so the user sees the device react quickly.
    const stream = activeStreams.get(req.serial)
    if (stream && !stream.stopped) {
      stream.lastHash = ''
      scheduleNextTick(stream, 140)
    }
    return { ok: true, cmd: `adb ${args.join(' ')}` }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    return {
      ok: false,
      error: code === 'ENOENT' ? 'adb_not_found' : error instanceof Error ? error.message : String(error),
    }
  }
}
