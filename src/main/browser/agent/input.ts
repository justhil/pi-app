// Humanized input on top of any PageEngine: curved pointer paths, click jitter, typing rhythm.

import { clickPoint, pointerPath, typingChunks } from '../humanize'
import type { Modifier, MouseButton, PageEngine, Rect } from '../engines/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One per tab: remembers where the pointer is so the next move starts there. */
export class Pointer {
  private pos = { x: 40, y: 40 }

  constructor(private readonly engine: PageEngine) {}

  async moveTo(x: number, y: number): Promise<void> {
    for (const p of pointerPath(this.pos, { x, y })) {
      if (p.delay) await sleep(p.delay)
      this.engine.mouse.move(p.x, p.y)
    }
    this.pos = { x, y }
  }

  async click(x: number, y: number, opts: { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] } = {}): Promise<void> {
    await this.moveTo(x, y)
    await sleep(40 + Math.random() * 80)
    const button = opts.button ?? 'left'
    const modifiers = opts.modifiers ?? []
    const count = opts.clickCount ?? 1
    for (let i = 1; i <= count; i++) {
      this.engine.mouse.down(x, y, { button, clickCount: i, modifiers })
      await sleep(50 + Math.random() * 60)
      this.engine.mouse.up(x, y, { button, clickCount: i, modifiers })
      if (i < count) await sleep(70)
    }
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await this.moveTo(from.x, from.y)
    const o = { button: 'left' as const, clickCount: 1, modifiers: [] }
    this.engine.mouse.down(from.x, from.y, o)
    await sleep(120)
    for (const p of pointerPath(from, to)) {
      await sleep(p.delay + 6)
      this.engine.mouse.move(p.x, p.y, 'left')
    }
    this.pos = to
    await sleep(80)
    this.engine.mouse.up(to.x, to.y, o)
  }

  async wheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.moveTo(x, y)
    // Real wheels scroll in notches; split large distances so smooth-scroll handlers see steps.
    const steps = Math.min(12, Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 400)))
    for (let i = 0; i < steps; i++) {
      this.engine.mouse.wheel(x, y, deltaX / steps, deltaY / steps)
      await sleep(30 + Math.random() * 40)
    }
  }
}

/** Point inside the element's hit-tested area: near the point the page runtime verified, jittered. */
export function targetPoint(point: { x: number; y: number }, rect: Rect): { x: number; y: number } {
  const jitter = clickPoint({ x: point.x - Math.min(6, rect.width / 6), y: point.y - Math.min(4, rect.height / 6), width: Math.min(12, rect.width / 3), height: Math.min(8, rect.height / 3) })
  return { x: Math.round(jitter.x), y: Math.round(jitter.y) }
}

/** Type into the focused element as trusted text input, with human-ish pacing. */
export async function typeText(engine: PageEngine, text: string): Promise<void> {
  for (const chunk of typingChunks(text)) {
    await engine.keyboard.insertText(chunk.text)
    await sleep(chunk.delay)
  }
}
