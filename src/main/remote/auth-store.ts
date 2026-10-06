import { randomBytes, timingSafeEqual } from 'node:crypto'
import { PAIR_TOKEN_TTL_MS, base64UrlDecode, base64UrlEncode, type Role } from '@shared/remote'
import { generateKeyPair, keyPairFromPrivate, type KeyPair } from '@shared/remote/crypto'
import type { RemoteHostPort } from './host-port'

/** Persisted gateway settings (config-store key `remote`). */
export type DeviceRecord = {
  id: string
  name: string
  platform: string
  /** X25519 static public key, base64url. */
  pub: string
  role: Role
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
}

export type RemoteStoredConfig = {
  enabled: boolean
  port: number
  hostId: string
  /** Host static private key, sealed with safeStorage (base64url inside). */
  hostKeySealed?: string
  devices: DeviceRecord[]
  /** Workspace paths remote clients may see and create sessions in. */
  projects: string[]
}

export const DEFAULT_REMOTE_PORT = 47900
const STORAGE_KEY = 'remote'

export type PairResult = 'ok' | 'pair_expired' | 'pair_used' | 'unpaired'

const randomId = (prefix: string, bytes = 9) => `${prefix}_${base64UrlEncode(randomBytes(bytes))}`

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class AuthStore {
  private cfg: RemoteStoredConfig
  private hostKeyPair: KeyPair | null = null
  private pairing: { token: string; exp: number } | null = null
  /** Tokens already exchanged (or replaced), kept briefly so a retry reports "used" instead of "unpaired". */
  private spentTokens: Array<{ token: string; at: number }> = []
  private ephemeralHostKey = false

  constructor(
    private readonly port: RemoteHostPort,
    private readonly now: () => number = Date.now,
  ) {
    const raw = port.storage.get(STORAGE_KEY) as Partial<RemoteStoredConfig> | undefined
    this.cfg = {
      enabled: raw?.enabled === true,
      port: typeof raw?.port === 'number' && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_REMOTE_PORT,
      hostId: typeof raw?.hostId === 'string' && raw.hostId ? raw.hostId : randomId('h'),
      ...(typeof raw?.hostKeySealed === 'string' ? { hostKeySealed: raw.hostKeySealed } : {}),
      devices: Array.isArray(raw?.devices) ? raw.devices.filter((d) => d && typeof d.pub === 'string' && typeof d.id === 'string') : [],
      projects: Array.isArray(raw?.projects) ? raw.projects.filter((p): p is string => typeof p === 'string') : [],
    }
    if (!raw?.hostId) this.save()
  }

  private save(): void {
    this.port.storage.set(STORAGE_KEY, structuredClone(this.cfg))
  }

  get config(): Readonly<RemoteStoredConfig> {
    return this.cfg
  }

  /** True when the host key could not be persisted (no OS keychain): phones must re-pair after restart. */
  get hostKeyIsEphemeral(): boolean {
    this.hostKey()
    return this.ephemeralHostKey
  }

  hostKey(): KeyPair {
    if (this.hostKeyPair) return this.hostKeyPair
    if (this.cfg.hostKeySealed) {
      const opened = this.port.secrets.open(this.cfg.hostKeySealed)
      if (opened) {
        try {
          this.hostKeyPair = keyPairFromPrivate(base64UrlDecode(opened))
          return this.hostKeyPair
        } catch {
          /* corrupt — regenerate below */
        }
      } else {
        // Keyring not unlocked yet / temporarily unavailable: keep the stored key and every pairing
        // for the next start instead of silently replacing the host identity (phones would all
        // have to scan again). This run uses a throwaway key; pairing still works for new phones.
        this.hostKeyPair = generateKeyPair()
        this.ephemeralHostKey = true
        this.port.log('warn', '[remote] could not unseal the host key; using a temporary one for this run')
        return this.hostKeyPair
      }
    }
    const kp = generateKeyPair()
    this.hostKeyPair = kp
    if (this.port.secrets.available()) {
      this.cfg.hostKeySealed = this.port.secrets.seal(base64UrlEncode(kp.priv))
      // A new host key invalidates every pairing: devices verified the old key.
      this.cfg.devices = []
      this.ephemeralHostKey = false
      this.save()
    } else {
      this.ephemeralHostKey = true
      this.port.log('warn', '[remote] OS encryption unavailable; host key kept in memory only')
    }
    return kp
  }

  setEnabled(enabled: boolean): void {
    this.cfg.enabled = enabled
    if (!enabled) this.pairing = null
    this.save()
  }

  setPort(port: number): void {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port')
    this.cfg.port = port
    this.save()
  }

  setProjects(projects: string[]): void {
    this.cfg.projects = [...new Set(projects.filter((p) => typeof p === 'string' && p.trim()))]
    this.save()
  }

  // ── Pairing tokens ──

  /** Issue a fresh one-time token; the previous one stops working immediately. */
  newPairToken(): { token: string; exp: number } {
    if (this.pairing) this.spend(this.pairing.token)
    this.pairing = { token: `pt_${base64UrlEncode(randomBytes(24))}`, exp: this.now() + PAIR_TOKEN_TTL_MS }
    return { ...this.pairing }
  }

  get currentPairing(): { token: string; exp: number } | null {
    if (this.pairing && this.pairing.exp <= this.now()) return null
    return this.pairing ? { ...this.pairing } : null
  }

  clearPairing(): void {
    if (this.pairing) this.spend(this.pairing.token)
    this.pairing = null
  }

  private spend(token: string): void {
    const cutoff = this.now() - 60 * 60_000
    this.spentTokens = [...this.spentTokens.filter((t) => t.at > cutoff), { token, at: this.now() }].slice(-20)
  }

  /** Validate and consume a pairing token (constant-time compare). */
  consumePairToken(token: string): PairResult {
    const p = this.pairing
    if (p && sameSecret(p.token, token)) {
      if (p.exp <= this.now()) {
        this.pairing = null
        this.spend(token)
        return 'pair_expired'
      }
      this.pairing = null
      this.spend(token)
      return 'ok'
    }
    if (this.spentTokens.some((t) => sameSecret(t.token, token))) return 'pair_used'
    return 'unpaired'
  }

  // ── Devices ──

  findDevice(pub: Uint8Array): DeviceRecord | undefined {
    const key = base64UrlEncode(pub)
    return this.cfg.devices.find((d) => d.pub === key)
  }

  registerDevice(pub: Uint8Array, name: string, platform: string): DeviceRecord {
    const key = base64UrlEncode(pub)
    const existing = this.cfg.devices.find((d) => d.pub === key)
    if (existing) {
      // Re-pairing a revoked phone gives it a clean record.
      existing.revokedAt = undefined
      existing.name = name || existing.name
      existing.platform = platform || existing.platform
      existing.lastSeenAt = this.now()
      this.save()
      return { ...existing }
    }
    const device: DeviceRecord = {
      id: randomId('d'),
      name: name.slice(0, 80) || 'Phone',
      platform: platform.slice(0, 40),
      pub: key,
      role: 'operator',
      createdAt: this.now(),
      lastSeenAt: this.now(),
    }
    this.cfg.devices = [...this.cfg.devices, device]
    this.save()
    return { ...device }
  }

  touchDevice(id: string): void {
    const d = this.cfg.devices.find((x) => x.id === id)
    if (!d) return
    d.lastSeenAt = this.now()
    this.save()
  }

  revokeDevice(id: string): boolean {
    const d = this.cfg.devices.find((x) => x.id === id)
    if (!d || d.revokedAt) return false
    d.revokedAt = this.now()
    this.save()
    return true
  }

  /** Forget a device entirely (Settings → 解绑). */
  removeDevice(id: string): boolean {
    const before = this.cfg.devices.length
    this.cfg.devices = this.cfg.devices.filter((d) => d.id !== id)
    if (this.cfg.devices.length === before) return false
    this.save()
    return true
  }

  setDeviceRole(id: string, role: Role): boolean {
    const d = this.cfg.devices.find((x) => x.id === id)
    if (!d) return false
    d.role = role
    this.save()
    return true
  }

  device(id: string): DeviceRecord | undefined {
    const d = this.cfg.devices.find((x) => x.id === id)
    return d ? { ...d } : undefined
  }
}
