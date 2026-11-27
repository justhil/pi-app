import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeAdbInputText,
  isValidAdbSerial,
  isValidKeyevent,
  parseAdbDevicesOutput,
  parseBatteryLevel,
  parseForegroundApp,
  parsePngDimensions,
  parseWmSizeOutput,
} from '../adb-service'
import { readCanvasFile, resolveCanvasFilePath } from '../canvas-file-service'

vi.mock('../../window', () => ({ getMainWindow: () => null }))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'native', distro: '' }) }))

describe('ADB service parsers & input sanitization', () => {
  it('parses adb devices -l output cleanly across USB, emulator and wireless serials', () => {
    const out = [
      'List of devices attached',
      'R5CX1234ABC            device usb:1-2 product:dm3q model:SM_S918B device:dm3q transport_id:4',
      '192.168.1.44:5555      device product:husky model:Pixel_8_Pro device:husky transport_id:7',
      'emulator-5554          offline transport_id:2',
    ].join('\n')

    const parsed = parseAdbDevicesOutput(out)
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({ serial: 'R5CX1234ABC', state: 'device', model: 'SM S918B' })
    expect(parsed[1]).toMatchObject({ serial: '192.168.1.44:5555', state: 'device', model: 'Pixel 8 Pro' })
    expect(parsed[2]).toMatchObject({ serial: 'emulator-5554', state: 'offline' })
  })

  it('parses wm size, battery level, foreground package and PNG header dimensions', () => {
    expect(parseWmSizeOutput('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({
      width: 720,
      height: 1600,
    })
    expect(parseBatteryLevel('  level: 84\n  scale: 100')).toBe(84)
    expect(
      parseForegroundApp('mCurrentFocus=Window{a1b2c3 u0 com.example.shop/com.example.shop.MainActivity}'),
    ).toBe('com.example.shop')

    const pngHeader = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader, 0)
    pngHeader.writeUInt32BE(1080, 16)
    pngHeader.writeUInt32BE(2340, 20)
    expect(parsePngDimensions(pngHeader)).toEqual({ width: 1080, height: 2340 })
    expect(parsePngDimensions(Buffer.from('not-a-png'))).toBeNull()
  })

  it('validates serials/keyevents and safely encodes ASCII input text while rejecting non-ASCII', () => {
    expect(isValidAdbSerial('192.168.1.10:5555')).toBe(true)
    expect(isValidAdbSerial('bad;rm -rf /')).toBe(false)
    expect(isValidKeyevent('4')).toBe(true)
    expect(isValidKeyevent('KEYCODE_HOME')).toBe(true)
    expect(isValidKeyevent('4;reboot')).toBe(false)

    expect(encodeAdbInputText('hello world & test')).toEqual({
      ok: true,
      encoded: 'hello%sworld%s\\&%stest',
    })
    expect(encodeAdbInputText('中文输入')).toEqual({
      ok: false,
      error: 'adb_text_ascii_only',
    })
  })
})

describe('Canvas local file service security & reading', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads text and image files inside the workspace root and rejects directory traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-canvas-file-test-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'report.md'), '# Architecture\n\nDetails here.', 'utf8')
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    await writeFile(join(dir, 'shot.png'), fakePng)

    const textRes = await readCanvasFile({ filePath: 'report.md', workspaceRoot: dir, mode: 'text' })
    expect(textRes.ok).toBe(true)
    expect(textRes.content).toContain('# Architecture')

    const imgRes = await readCanvasFile({ filePath: 'shot.png', workspaceRoot: dir, mode: 'image' })
    expect(imgRes.ok).toBe(true)
    expect(imgRes.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)

    const escaped = await resolveCanvasFilePath('../../etc/passwd', dir)
    expect(escaped.ok).toBe(false)
  })
})
