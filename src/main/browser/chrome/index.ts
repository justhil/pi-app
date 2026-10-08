// The user's-Chrome side of the browser tools: one bridge (local WebSocket for the pi
// extension) and one host, started when the user turns "My Chrome" on.

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { BROWSER_EVENT_CHANNEL, type BrowserEvent } from '@shared/browser-types'
import { configStore } from '../../config-store'
import { getMainWindow } from '../../window'
import { respondHelp } from '../agent/help'
import { ChromeBridge } from './bridge'
import { ChromeHost } from './chrome-host'

export interface ChromeBridgeStatus {
  enabled: boolean
  listening: boolean
  port: number
  connected: boolean
  browser: string | null
  pairingCode: string | null
  extensionPath: string
}

let bridge: ChromeBridge | null = null
let host: ChromeHost | null = null
const statusListeners = new Set<() => void>()

const toRenderer = (event: BrowserEvent) => {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(BROWSER_EVENT_CHANNEL, event)
}

/** Help requests in Chrome also become a Chrome notification with Done / Give up buttons. */
const send = (event: BrowserEvent) => {
  toRenderer(event)
  if (!bridge?.connected()) return
  if (event.type === 'help-request' && event.request.where === 'chrome') {
    const zh = configStore.get('language') !== 'en'
    const r = event.request
    void bridge
      .call('help.show', {
        id: r.id,
        title: zh ? 'pi 需要你操作一下' : 'pi needs you',
        message: [r.prompt, r.target ? (zh ? `位置：${r.target}` : `At: ${r.target}`) : ''].filter(Boolean).join('\n'),
        yes: r.confirm ? (zh ? '允许' : 'Allow') : zh ? '完成' : 'Done',
        no: r.confirm ? (zh ? '拒绝' : 'Deny') : zh ? '放弃' : 'Give up',
      })
      .catch(() => undefined)
  } else if (event.type === 'help-ended') void bridge.call('help.clear', { id: event.id }).catch(() => undefined)
}

function config() {
  return configStore.get('browserChromeBridge') ?? { enabled: false, port: 19825, token: '' }
}

function ensureToken(): string {
  const c = config()
  if (c.token) return c.token
  const token = randomBytes(24).toString('base64url')
  configStore.set('browserChromeBridge', { ...c, token })
  return token
}

export function extensionPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'chrome-extension') : join(app.getAppPath(), 'resources', 'chrome-extension')
}

export function chromeBridgeStatus(): ChromeBridgeStatus {
  const c = config()
  const port = bridge?.port || c.port
  return {
    enabled: c.enabled,
    listening: !!bridge?.port,
    port,
    connected: !!bridge?.connected(),
    browser: bridge?.hello ? bridge.hello.ua.match(/(Edg|Chrome)\/[\d.]+/)?.[0] ?? 'Chromium' : null,
    pairingCode: c.enabled && c.token ? `pi-bridge:${port}:${c.token}` : null,
    extensionPath: extensionPath(),
  }
}

export function onChromeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

const changed = () => {
  for (const l of statusListeners) l()
}

export async function startChromeBridge(): Promise<void> {
  if (!config().enabled) return
  ensureToken()
  if (!bridge) {
    bridge = new ChromeBridge({ token: () => config().token, onStatus: changed })
    // The notification's buttons answer the help request.
    bridge.on((event, p) => {
      if (event === 'help.respond' && (p.outcome === 'completed' || p.outcome === 'cancelled')) respondHelp(String(p.id), p.outcome)
    })
  }
  host ??= new ChromeHost(bridge, send)
  await bridge.start(config().port)
  changed()
}

export async function setChromeBridgeEnabled(enabled: boolean): Promise<ChromeBridgeStatus> {
  configStore.set('browserChromeBridge', { ...config(), enabled })
  if (enabled) await startChromeBridge()
  else {
    bridge?.stop()
    bridge = null
    host = null
  }
  changed()
  return chromeBridgeStatus()
}

/** New pairing code: the paired extension is disconnected until it gets the new one. */
export async function regenerateChromeToken(): Promise<ChromeBridgeStatus> {
  configStore.set('browserChromeBridge', { ...config(), token: randomBytes(24).toString('base64url') })
  if (bridge) {
    bridge.stop()
    await bridge.start(config().port)
  }
  changed()
  return chromeBridgeStatus()
}

export function getChromeHost(): ChromeHost | null {
  return host
}

export function chromeBridgeEnabled(): boolean {
  return config().enabled
}
