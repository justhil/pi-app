import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'pi-remote-att-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { readRemoteAttachment, writeRemoteAttachment } = await import('../clipboard-temp-images')

describe('readRemoteAttachment', () => {
  it('reads files the phone uploaded', () => {
    const path = writeRemoteAttachment(Buffer.from('jpeg'), 'IMG 1.jpg')
    expect(readRemoteAttachment(path)).toMatchObject({ mime: 'image/jpeg' })
    expect(readRemoteAttachment(path)!.bytes.toString()).toBe('jpeg')
  })

  it('refuses paths outside the attachment dir, symlinks out of it and non pi-clipboard names', () => {
    const outside = join(userData, 'secret.txt')
    writeFileSync(outside, 'secret')
    expect(readRemoteAttachment(outside)).toBeNull()
    const dir = join(userData, 'clipboard-images')
    mkdirSync(dir, { recursive: true })
    const link = join(dir, 'pi-clipboard-link.txt')
    symlinkSync(outside, link)
    expect(readRemoteAttachment(link)).toBeNull()
    writeFileSync(join(dir, 'other.png'), 'x')
    expect(readRemoteAttachment(join(dir, 'other.png'))).toBeNull()
    expect(readRemoteAttachment(join(dir, '..', 'secret.txt'))).toBeNull()
    expect(readRemoteAttachment('/etc/passwd')).toBeNull()
  })
})
