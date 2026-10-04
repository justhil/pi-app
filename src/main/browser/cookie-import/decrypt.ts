// Chromium cookie value decryption. Adapted from Orca (MIT, see NOTICE.md).

import { createDecipheriv } from 'node:crypto'
import type { EncryptionKey } from './keys'

/** Chromium 127+ prepends a 32-byte SHA-256 of the host to the plaintext. */
const HMAC_LEN = 32

function stripHostHash(buf: Buffer): Buffer {
  if (buf.length <= HMAC_LEN) return buf
  let nonPrintable = 0
  for (let i = 0; i < HMAC_LEN; i++) if (buf[i] < 0x20 || buf[i] > 0x7e) nonPrintable++
  return nonPrintable >= 8 ? buf.subarray(HMAC_LEN) : buf
}

export function encryptionVersion(encrypted: Buffer): string | null {
  if (encrypted.length < 3) return null
  const v = encrypted.subarray(0, 3).toString('utf-8')
  return /^v\d\d$/.test(v) ? v : null
}

/** Windows Chrome/Edge 127+ `v20`: app-bound encryption only the writing browser can unwrap. */
export const isAppBound = (encrypted: Buffer) => encryptionVersion(encrypted) === 'v20'

export function decryptCookieValue(encrypted: Buffer, key: EncryptionKey): Buffer | null {
  const version = encryptionVersion(encrypted)
  if (!version) return null
  const payload = encrypted.subarray(3)
  try {
    if (key.mode === 'aes-256-gcm') {
      if (payload.length < 28) return null
      const d = createDecipheriv('aes-256-gcm', key.key, payload.subarray(0, 12))
      d.setAuthTag(payload.subarray(-16))
      return stripHostHash(Buffer.concat([d.update(payload.subarray(12, -16)), d.final()]))
    }
    const k = version === 'v10' || version === 'v11' ? key.keysByVersion[version] : undefined
    if (!k || !payload.length) return null
    const d = createDecipheriv('aes-128-cbc', k, Buffer.alloc(16, ' '))
    return stripHostHash(Buffer.concat([d.update(payload), d.final()]))
  } catch {
    return null
  }
}
