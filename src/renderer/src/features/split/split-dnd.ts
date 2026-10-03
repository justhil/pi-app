import type { PaneSession } from './split-layout'

/** Drag payloads: a session (from the sidebar or a pane header) or a pane being moved. */
export const SESSION_MIME = 'application/x-pi-session'
export const PANE_MIME = 'application/x-pi-pane'

export type DropZone = 'left' | 'right' | 'center'

/** Outer quarters split beside the pane; the middle replaces what it shows. */
export function zoneAt(fraction: number): DropZone {
  return fraction < 0.25 ? 'left' : fraction > 0.75 ? 'right' : 'center'
}

/** Lightweight drag image: a small label, never a copy of the chat UI. */
export function setDragLabel(e: DragEvent | React.DragEvent, text: string): void {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText =
    'position:fixed;top:-100px;left:-100px;max-width:220px;padding:4px 10px;border-radius:8px;font:12px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--popover, #fff);color:var(--foreground, #111);box-shadow:0 4px 14px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08)'
  document.body.appendChild(el)
  e.dataTransfer?.setDragImage(el, 12, 12)
  setTimeout(() => el.remove(), 0)
}

export function startSessionDrag(e: React.DragEvent, session: PaneSession): void {
  e.dataTransfer.setData(SESSION_MIME, JSON.stringify(session))
  e.dataTransfer.effectAllowed = 'copyMove'
  setDragLabel(e, session.title || session.sessionFile.split(/[\\/]/).pop() || '')
}

export function readSessionDrag(e: React.DragEvent): PaneSession | null {
  try {
    const raw = e.dataTransfer.getData(SESSION_MIME)
    const s = raw ? (JSON.parse(raw) as PaneSession) : null
    return s && typeof s.sessionFile === 'string' && typeof s.sessionId === 'string' ? s : null
  } catch {
    return null
  }
}

/** Open a session in a new pane from anywhere without importing the split store. */
export const OPEN_IN_PANE_EVENT = 'pi-desktop:open-in-pane'
export function requestOpenInPane(session: PaneSession): void {
  window.dispatchEvent(new CustomEvent<PaneSession>(OPEN_IN_PANE_EVENT, { detail: session }))
}

export const isSplitDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(SESSION_MIME) || e.dataTransfer.types.includes(PANE_MIME)
