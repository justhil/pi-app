// Chromium cookie encryption keys per platform. Adapted from Orca (MIT, see NOTICE.md).
// macOS: Keychain password → PBKDF2 → AES-128-CBC (the system shows its own prompt).
// Linux: libsecret password (v11) or the built-in "peanuts" (v10) → AES-128-CBC.
// Windows: DPAPI-protected master key in Local State → AES-256-GCM (v20 app-bound can't be read).

import { spawnSync } from 'node:child_process'
import { pbkdf2Sync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserRootPath, type ChromiumBrowserDef } from './browsers'

export type EncryptionKey =
  | { mode: 'aes-128-cbc'; keysByVersion: Partial<Record<'v10' | 'v11', Buffer>>; keyringUnavailable?: boolean }
  | { mode: 'aes-256-gcm'; key: Buffer }

const SALT = 'saltysalt'

function run(program: string, args: string[], timeoutMs: number, input?: string): string | null {
  try {
    const r = spawnSync(program, args, { timeout: timeoutMs, encoding: 'utf-8', input, windowsHide: true })
    return r.status === 0 && !r.error ? r.stdout.trim() : null
  } catch {
    return null
  }
}

export function macKey(def: ChromiumBrowserDef): EncryptionKey | null {
  const raw = run('security', ['find-generic-password', '-s', def.keychainService, '-a', def.keychainAccount, '-w'], 30_000)
  return raw ? { mode: 'aes-128-cbc', keysByVersion: { v10: pbkdf2Sync(raw, SALT, 1003, 16, 'sha1') } } : null
}

export function linuxKey(def: ChromiumBrowserDef): EncryptionKey {
  const v10 = pbkdf2Sync('peanuts', SALT, 1, 16, 'sha1')
  const password =
    run('secret-tool', ['lookup', 'service', def.keychainService, 'account', def.keychainAccount], 5000) ||
    run('secret-tool', ['lookup', 'application', def.linuxApplication], 5000)
  if (!password) return { mode: 'aes-128-cbc', keysByVersion: { v10 }, keyringUnavailable: true }
  return { mode: 'aes-128-cbc', keysByVersion: { v10, v11: pbkdf2Sync(password, SALT, 1, 16, 'sha1') } }
}

export function windowsKey(def: ChromiumBrowserDef): EncryptionKey | null {
  const root = browserRootPath(def)
  const localState = root && join(root, 'Local State')
  if (!localState || !existsSync(localState)) return null
  try {
    const b64 = JSON.parse(readFileSync(localState, 'utf-8'))?.os_crypt?.encrypted_key
    if (typeof b64 !== 'string') return null
    const blob = Buffer.from(b64, 'base64')
    if (blob.subarray(0, 5).toString() !== 'DPAPI') return null
    // DPAPI without a native addon: PowerShell reads the blob from stdin (no command injection).
    const script =
      'try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop } catch { try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch {} };' +
      '$in=[Convert]::FromBase64String([Console]::In.ReadLine());' +
      '$out=[System.Security.Cryptography.ProtectedData]::Unprotect($in,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Convert]::ToBase64String($out)'
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const out = run(ps, ['-NoProfile', '-NonInteractive', '-Command', script], 10_000, blob.subarray(5).toString('base64'))
    return out ? { mode: 'aes-256-gcm', key: Buffer.from(out, 'base64') } : null
  } catch {
    return null
  }
}

export function encryptionKeyFor(def: ChromiumBrowserDef): EncryptionKey | null {
  if (process.platform === 'darwin') return macKey(def)
  if (process.platform === 'win32') return windowsKey(def)
  return linuxKey(def)
}
