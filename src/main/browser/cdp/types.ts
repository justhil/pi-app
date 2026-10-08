// The DevTools protocol as the agent uses it, behind one interface: the built-in browser
// attaches `webContents.debugger` (electron-cdp.ts), the user's Chrome relays chrome.debugger
// through the pi extension. Tool features written against CdpSession work in both.
//
// Never send `Runtime.enable`: it is the one domain pages can detect (console serialization
// side effects). `Runtime.evaluate` works without it, given a contextId or in the main world.

export type CdpListener = (method: string, params: Record<string, unknown>, sessionId?: string) => void

export interface CdpSession {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>
  on(listener: CdpListener): () => void
  /** Detach; later sends reattach. */
  close(): void
}
