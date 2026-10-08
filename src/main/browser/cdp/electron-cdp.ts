import type { WebContents } from 'electron'
import { BrowserToolError } from '../agent/errors'
import type { CdpListener, CdpSession } from './types'

/**
 * CDP over `webContents.debugger`, attached lazily for agent tabs only (a tab the user browses
 * by hand never gets a debugger). Detached by DevTools or a crash: the next send reattaches.
 */
export class ElectronCdp implements CdpSession {
  private listeners = new Set<CdpListener>()
  private wired = false

  constructor(private readonly wc: WebContents) {}

  private attach(): void {
    const dbg = this.wc.debugger
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3')
      } catch (error) {
        throw new BrowserToolError('browser_unsupported', `cannot attach the DevTools protocol: ${(error as Error).message}`)
      }
    }
    if (!this.wired) {
      this.wired = true
      dbg.on('message', (_event, method, params, sessionId) => {
        for (const l of this.listeners) l(method, params ?? {}, sessionId || undefined)
      })
      dbg.on('detach', () => {
        this.wired = false
        dbg.removeAllListeners('message')
        dbg.removeAllListeners('detach')
        for (const l of this.listeners) l('pi.detached', {})
      })
    }
  }

  async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (method === 'Runtime.enable') throw new Error('Runtime.enable is not allowed (pages can detect it)')
    if (this.wc.isDestroyed()) throw new BrowserToolError('browser_no_tab', 'the tab was closed')
    this.attach()
    return (await this.wc.debugger.sendCommand(method, params, sessionId)) as T
  }

  on(listener: CdpListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    if (!this.wc.isDestroyed() && this.wc.debugger.isAttached()) this.wc.debugger.detach()
  }
}
