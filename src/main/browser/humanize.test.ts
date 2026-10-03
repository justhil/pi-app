import { describe, expect, it } from 'vitest'
import { clickPoint, pointerPath, seededRng, typingChunks } from './humanize'

describe('humanize', () => {
  it('produces reproducible paths that end on the target', () => {
    const a = pointerPath({ x: 0, y: 0 }, { x: 400, y: 300 }, seededRng(7))
    const b = pointerPath({ x: 0, y: 0 }, { x: 400, y: 300 }, seededRng(7))
    expect(a).toEqual(b)
    expect(a.at(-1)).toMatchObject({ x: 400, y: 300 })
    expect(a.length).toBeGreaterThanOrEqual(6)
    expect(a.every((p) => p.delay >= 5 && p.delay <= 16)).toBe(true)
  })

  it('jumps straight to very close targets', () => {
    expect(pointerPath({ x: 10, y: 10 }, { x: 11, y: 10 })).toEqual([{ x: 11, y: 10, delay: 0 }])
  })

  it('clicks inside the element', () => {
    const rng = seededRng(3)
    for (let i = 0; i < 50; i++) {
      const p = clickPoint({ x: 100, y: 50, width: 80, height: 30 }, rng)
      expect(p.x).toBeGreaterThan(100)
      expect(p.x).toBeLessThan(180)
      expect(p.y).toBeGreaterThan(50)
      expect(p.y).toBeLessThan(80)
    }
  })

  it('types every character exactly once', () => {
    const chunks = typingChunks('你好, world!', seededRng(1))
    expect(chunks.map((c) => c.text).join('')).toBe('你好, world!')
    expect(chunks.every((c) => c.delay >= 35 && c.delay <= 220)).toBe(true)
  })
})
