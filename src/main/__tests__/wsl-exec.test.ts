import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFileSync: mocks.execFileSync, spawn: mocks.spawn },
  execFileSync: mocks.execFileSync,
  spawn: mocks.spawn,
}))

import {
  decodeWslOutput,
  runWslSync,
  runWslDistroCdSync,
  wslDefaultShellSync,
  wslHomeDirSync,
  invalidateWslEnvCaches,
} from '../wsl/wsl-exec'

function utf16leBom(s: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])
}

describe('decodeWslOutput', () => {
  it('decodes UTF-16LE with BOM', () => {
    expect(decodeWslOutput(utf16leBom('Debian'))).toBe('Debian')
  })

  it('decodes UTF-16LE CRLF lines without interleaved nulls', () => {
    const lines = decodeWslOutput(utf16leBom('Debian\r\nUbuntu\r\n'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    expect(lines).toEqual(['Debian', 'Ubuntu'])
  })

  it('strips a UTF-8 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Debian', 'utf-8')])
    expect(decodeWslOutput(buf)).toBe('Debian')
  })

  it('passes plain utf-8 through unchanged', () => {
    expect(decodeWslOutput(Buffer.from('Debian', 'utf-8'))).toBe('Debian')
  })

  it('decodes UTF-16LE without a BOM (the exact bytes wsl.exe emits)', () => {
    // From a real system (Format-Hex): 44 00 65 00 62 00 69 00 61 00 6E 00 0D 00 0A 00
    const buf = Buffer.from([0x44, 0x00, 0x65, 0x00, 0x62, 0x00, 0x69, 0x00, 0x61, 0x00, 0x6e, 0x00, 0x0d, 0x00, 0x0a, 0x00])
    expect(decodeWslOutput(buf)).toBe('Debian\r\n')
  })

  it('decodes multi-line UTF-16LE without a BOM', () => {
    expect(decodeWslOutput(Buffer.from('Debian\r\nUbuntu\r\n', 'utf16le'))).toBe('Debian\r\nUbuntu\r\n')
  })

  it('leaves plain utf-8 probe output untouched (no null bytes)', () => {
    expect(decodeWslOutput(Buffer.from('/usr/bin/git\n', 'utf-8'))).toBe('/usr/bin/git\n')
  })

  it('decodes UTF-16BE without a BOM', () => {
    const le = Buffer.from('Debian', 'utf16le')
    const be = Buffer.alloc(le.length)
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1]
      be[i + 1] = le[i]
    }
    expect(decodeWslOutput(be)).toBe('Debian')
  })

  it('handles nullish input', () => {
    expect(decodeWslOutput(null)).toBe('')
    expect(decodeWslOutput(undefined)).toBe('')
  })
})

describe('runWslSync', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset()
  })

  it('decodes UTF-16LE stdout returned by wsl.exe', () => {
    mocks.execFileSync.mockReturnValue(utf16leBom('Debian'))
    const r = runWslSync(['--list', '--quiet'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('Debian')
    expect(mocks.execFileSync).toHaveBeenCalledWith('wsl.exe', expect.any(Array), expect.objectContaining({ windowsHide: true }))
  })

  it('decodes UTF-16LE stdout without a BOM', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('Debian\r\n', 'utf16le'))
    const r = runWslSync(['--list', '--quiet'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('Debian\r\n')
  })

  it('decodes UTF-16LE stdout/stderr on failure', () => {
    const err = new Error('command failed') as Error & { status?: number; stdout?: Buffer; stderr?: Buffer }
    err.status = 1
    err.stdout = utf16leBom('Debian')
    err.stderr = utf16leBom('Error text')
    mocks.execFileSync.mockImplementation(() => {
      throw err
    })
    const r = runWslSync(['--list', '--quiet'])
    expect(r.status).toBe(1)
    expect(r.stdout).toBe('Debian')
    expect(r.stderr).toBe('Error text')
  })
})

describe('runWslDistroCdSync', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset()
  })

  it('places --cd before the -- separator', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('', 'utf-8'))
    runWslDistroCdSync('Debian', '/', ['true'])
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Debian', '--cd', '/', '--', 'true'],
      expect.anything(),
    )
  })

  it('rejects an invalid distro without spawning', () => {
    const r = runWslDistroCdSync('bad;name', '/', ['true'])
    expect(r.status).toBe(-1)
    expect(mocks.execFileSync).not.toHaveBeenCalled()
  })
})

describe('wslDefaultShellSync', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset()
    invalidateWslEnvCaches()
  })

  it('returns the basename of the login shell (zsh)', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('/usr/bin/zsh', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
  })

  it('returns bash for a bash login shell', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('/bin/bash', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('bash')
  })

  it('falls back to bash when the probe fails', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('wsl not available')
    })
    expect(wslDefaultShellSync('Debian')).toBe('bash')
  })

  it('falls back to bash for nologin shells', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('/usr/sbin/nologin', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('bash')
  })

  it('uses the simple printf $SHELL probe (no nested quoting)', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('zsh', 'utf-8'))
    wslDefaultShellSync('Debian')
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Debian', '--', 'bash', '-lc', 'printf %s "$SHELL"'],
      expect.anything(),
    )
  })

  it('caches the shell probe per distro (one wsl.exe call for repeated lookups)', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('zsh', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1)
  })

  it('invalidates the shell cache per distro', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('zsh', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
    invalidateWslEnvCaches('Debian')
    mocks.execFileSync.mockReturnValue(Buffer.from('/bin/bash', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('bash')
    expect(mocks.execFileSync).toHaveBeenCalledTimes(2)
  })

  it('distro caches are independent', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('zsh', 'utf-8'))
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
    expect(wslDefaultShellSync('Ubuntu')).toBe('zsh')
    expect(mocks.execFileSync).toHaveBeenCalledTimes(2)
    expect(wslDefaultShellSync('Debian')).toBe('zsh')
    expect(mocks.execFileSync).toHaveBeenCalledTimes(2)
  })
})

describe('wslHomeDirSync', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset()
    invalidateWslEnvCaches()
  })

  it('returns the home dir and caches it per distro', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('/home/pi', 'utf-8'))
    expect(wslHomeDirSync('Debian')).toBe('/home/pi')
    expect(wslHomeDirSync('Debian')).toBe('/home/pi')
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1)
  })

  it('returns null for an unusable distro', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('wsl not available')
    })
    expect(wslHomeDirSync('Debian')).toBeNull()
  })
})
