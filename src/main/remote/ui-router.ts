import { normalizeSessionFileKey } from '@shared/session-file-key'
import { UiRequestSchema, type UiRequest, type UiResponse } from '@shared/remote'
import type { RemoteHostPort } from './host-port'

/**
 * Pending extension UI dialogs. Every request goes to the desktop and to every client that has
 * the session open; the first answer wins and everyone else gets `ui.dismiss`. Unknown kinds
 * are never forwarded, so they stay answerable on the desktop and never block the agent.
 */
export class UiRouter {
  private readonly pending = new Map<string, UiRequest>()

  constructor(
    private readonly port: RemoteHostPort,
    private readonly broadcast: (event: 'ui.request' | 'ui.dismiss', payload: unknown, sessionKey: string) => void,
  ) {}

  /** Raw desktop request (`ExtensionUIRequest` + `sessionFile`). */
  onDesktopRequest(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const { sessionFile, ...rest } = raw as Record<string, unknown> & { sessionFile?: string }
    if (!sessionFile) return
    const parsed = UiRequestSchema.safeParse({ ...rest, sessionKey: normalizeSessionFileKey(sessionFile) })
    if (!parsed.success) return
    const req = parsed.data
    if (req.method !== 'notify') this.pending.set(req.id, req)
    this.broadcast('ui.request', req, req.sessionKey)
  }

  /** Someone other than a remote client resolved it (desktop answer, timeout, worker exit). */
  onResolved(id: string, by: 'desktop' | 'remote' | 'system'): void {
    const req = this.pending.get(id)
    if (!req) return
    this.pending.delete(id)
    this.broadcast('ui.dismiss', { id, sessionKey: req.sessionKey, by }, req.sessionKey)
  }

  /** A remote client answered. Returns false when it was already answered elsewhere. */
  respond(response: UiResponse): boolean {
    const req = this.pending.get(response.id)
    if (!req) return false
    this.pending.delete(response.id)
    this.port.respondUi(response)
    this.port.dismissDesktopUi(response.id)
    this.broadcast('ui.dismiss', { id: response.id, sessionKey: req.sessionKey, by: 'remote' }, req.sessionKey)
    return true
  }

  cancel(id: string): boolean {
    const req = this.pending.get(id)
    if (!req) return false
    this.pending.delete(id)
    this.port.cancelUi(id)
    this.port.dismissDesktopUi(id)
    this.broadcast('ui.dismiss', { id, sessionKey: req.sessionKey, by: 'remote' }, req.sessionKey)
    return true
  }

  pendingFor(sessionKey: string): UiRequest[] {
    return [...this.pending.values()].filter((r) => r.sessionKey === sessionKey)
  }

  /** Sessions with at least one unanswered dialog → first request (for inbox previews). */
  pendingBySession(): Map<string, UiRequest> {
    const out = new Map<string, UiRequest>()
    for (const r of this.pending.values()) if (!out.has(r.sessionKey)) out.set(r.sessionKey, r)
    return out
  }
}
