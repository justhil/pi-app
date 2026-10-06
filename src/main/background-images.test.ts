import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeBackground } from '@shared/background'
import { importBackgroundImage, pruneBackgroundImages, readBackgroundImage } from './background-images'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-bg-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('background images', () => {
  it('copies by content hash, reads back, rejects other types, prunes unreferenced files', async () => {
    const dir = join(root, 'backgrounds')
    const src = join(root, 'Photo.JPEG')
    await writeFile(src, Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]))
    const a = await importBackgroundImage(dir, src)
    const b = await importBackgroundImage(dir, src)
    expect(a).toEqual(b)
    if (!a.ok) throw new Error('import failed')
    expect(a.file).toMatch(/^[a-f0-9]{24}\.jpg$/)
    expect((await readBackgroundImage(dir, a.file))?.mime).toBe('image/jpeg')
    expect(await readBackgroundImage(dir, '../secret.png')).toBeNull()

    await writeFile(join(root, 'notes.txt'), 'x')
    expect(await importBackgroundImage(dir, join(root, 'notes.txt'))).toEqual({ ok: false, error: 'type' })

    const other = join(root, 'other.png')
    await writeFile(other, 'png')
    const c = await importBackgroundImage(dir, other)
    expect(await pruneBackgroundImages(dir, [a.file])).toBe(1)
    expect(await readdir(dir)).toEqual([a.file])
    expect(c.ok).toBe(true)
  })

  it('normalizes settings, clamping values and dropping unsafe file names', () => {
    expect(normalizeBackground(null)).toEqual({ shared: true })
    const bg = normalizeBackground({ shared: false, light: { file: '0123456789abcdef0123.png', opacity: 4, blur: 99, uiOpacity: 0.1, fit: 'x' }, dark: { file: '../x.png' } })
    expect(bg).toEqual({ shared: false, light: { file: '0123456789abcdef0123.png', opacity: 1, blur: 24, uiOpacity: 0.5, fit: 'cover', position: 'center' } })
  })
})
