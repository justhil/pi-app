// The only engine-specific layer of browser automation. Tool logic (agent/tools.ts), the page
// runtime (src/browser-runtime/page) and humanized input (agent/input.ts) are shared; an engine
// supplies isolated-world evaluation, raw input, capture and navigation for one tab.

import type { BrowserLogEntry } from '@shared/browser-types'

export type MouseButton = 'left' | 'right' | 'middle'
export type Modifier = 'alt' | 'control' | 'meta' | 'shift'
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
}

export interface PageEngine {
  readonly id: 'electron' | 'stealth'
  /**
   * Evaluate `expr` in the page's isolated world with the runtime available as `__piBrowser`
   * (installed on first use per document). Rejects with browser_dialog_pending when a modal
   * dialog blocks the page.
   */
  run<T>(expr: string, timeoutMs?: number): Promise<T>
  mouse: {
    move(x: number, y: number, button?: MouseButton): void
    down(x: number, y: number, o: { button: MouseButton; clickCount: number; modifiers: Modifier[] }): void
    up(x: number, y: number, o: { button: MouseButton; clickCount: number; modifiers: Modifier[] }): void
    /** DOM convention: positive deltaY scrolls down. */
    wheel(x: number, y: number, deltaX: number, deltaY: number): void
  }
  keyboard: {
    /** One key or chord: `Enter`, `ArrowDown`, `Control+A`. */
    press(spec: string): Promise<void>
    insertText(text: string): Promise<void>
  }
  /** Viewport (or `clip`) PNG; works while the tab is hidden. */
  screenshot(o: { clip?: Rect; maxWidth?: number }): Promise<{ png: Buffer; width: number; height: number }>
  pdf(): Promise<Buffer>
  navigate(url: string): Promise<void>
  back(): Promise<boolean>
  url(): string
  title(): string
  isLoading(): boolean
  logs(): BrowserLogEntry[]
  /** Network requests the page still has in flight (long-lived streams excluded). */
  pendingRequests(): number
  /** Engines that can see and answer JS dialogs (stealth); Electron cannot. */
  dialog?: { pending(): DialogInfo | null; handle(accept: boolean, promptText?: string): Promise<void> }
}
