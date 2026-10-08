import { BrowserToolError } from '../agent/errors'
import type { CdpListener, CdpSession } from '../cdp/types'
import type { ChromeBridge } from './bridge'

/** CDP of one Chrome tab, relayed by the pi extension (chrome.debugger; sessions need Chrome 125+). */
export class ExtensionCdp implements CdpSession {
  private attached = false
  private attaching: Promise<void> | null = null
  private listeners = new Set<CdpListener>()

  constructor(
    private readonly bridge: ChromeBridge,
    readonly tabId: number,
  ) {
    bridge.on((event, p) => {
      if (event === 'cdp.event' && p.tabId === tabId) {
        for (const l of this.listeners) l(p.method, p.params ?? {}, p.sessionId || undefined)
      } else if ((event === 'debugger.detached' && p.tabId === tabId) || event === 'bridge.disconnected') {
        this.attached = false
        for (const l of this.listeners) l('pi.detached', {})
      }
    })
  }

  private async attach(): Promise<void> {
    if (this.attached) return
    this.attaching ??= this.bridge
      .call('debugger.attach', { tabId: this.tabId })
      .then(() => {
        this.attached = true
      })
      .finally(() => {
        this.attaching = null
      })
    await this.attaching
  }

  async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (method === 'Runtime.enable') throw new Error('Runtime.enable is not allowed (pages can detect it)')
    try {
      await this.attach()
      return await this.bridge.call<T>('cdp', { tabId: this.tabId, method, params, ...(sessionId ? { sessionId } : {}) })
    } catch (error) {
      const message = (error as Error).message
      if (/not connected|disconnected/i.test(message)) throw new BrowserToolError('browser_unsupported', message)
      if (/No tab with given id|tab was closed|only drive tabs/i.test(message)) throw new BrowserToolError('browser_no_tab', 'the Chrome tab is gone; call browser_tabs action "list"')
      if (/Cannot access|chrome:\/\/|Cannot attach/i.test(message)) throw new BrowserToolError('browser_denied', `Chrome does not allow automating this page (${message})`)
      throw error
    }
  }

  on(listener: CdpListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.attached = false
    void this.bridge.call('debugger.detach', { tabId: this.tabId }).catch(() => undefined)
  }
}
