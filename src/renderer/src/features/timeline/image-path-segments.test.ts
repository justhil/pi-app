import { describe, expect, it } from 'vitest'
import { splitImagePathSegments } from './image-path-segments'

const text = (t: string) => [{ type: 'text' as const, text: t }]

describe('splitImagePathSegments', () => {
  it('turns the path a reloaded prompt carries back into an image segment', () => {
    const out = splitImagePathSegments(text('look at C:\\Users\\me\\clipboard-images\\pi-clipboard-1.png'))
    expect(out).toEqual([
      { type: 'text', text: 'look at' },
      {
        type: 'file',
        attachment: { path: 'C:\\Users\\me\\clipboard-images\\pi-clipboard-1.png', name: 'pi-clipboard-1.png', kind: 'image' },
      },
    ])
  })

  it('handles the quoted @path form and keeps the surrounding words', () => {
    const out = splitImagePathSegments(text('see @"C:\\tmp\\K DP.png" now'))
    expect(out.map((s) => s.type)).toEqual(['text', 'file', 'text'])
    expect(out.at(-1)).toEqual({ type: 'text', text: 'now' })
  })

  it('ignores paths that are not pictures and rows that already carry one', () => {
    const code = text('open C:\\src\\main.ts')
    expect(splitImagePathSegments(code)).toEqual(code)

    const withImage = [
      { type: 'clipboard-image' as const, path: 'p', name: 'n' },
      { type: 'text' as const, text: 'x' },
    ]
    expect(splitImagePathSegments(withImage)).toBe(withImage)
  })
})
