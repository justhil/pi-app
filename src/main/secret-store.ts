import { safeStorage } from 'electron'

const STORE_KEY = 'codexAccessTokenEnc'

let backing: { get: (k: string) => unknown; set: (k: string, v: unknown) => void; delete?: (k: string) => void } | null =
  null

export function bindSecretStoreBacking(store: {
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  delete?: (k: string) => void
}): void {
  backing = store
}

export function isCodexTokenEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function setCodexAccessToken(token: string | null | undefined): void {
  if (!backing) return
  const t = token?.trim()
  if (!t || t.length < 20) {
    if (backing.delete) backing.delete(STORE_KEY)
    else backing.set(STORE_KEY, undefined)
    return
  }
  if (!isCodexTokenEncryptionAvailable()) {
    console.warn('[secret-store] safeStorage unavailable; codex token not persisted')
    return
  }
  const enc = safeStorage.encryptString(t)
  backing.set(STORE_KEY, enc.toString('base64'))
}

export function getCodexAccessToken(): string | null {
  if (!backing) return null
  const raw = backing.get(STORE_KEY)
  if (raw == null || raw === '') return null
  if (!isCodexTokenEncryptionAvailable()) return null
  try {
    const buf = Buffer.from(String(raw), 'base64')
    const plain = safeStorage.decryptString(buf)
    return plain && plain.length >= 20 ? plain : null
  } catch {
    return null
  }
}