import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { RemoteHostPort } from './host-port'

/**
 * Open-source scripts phones may download over plain HTTP (`GET /assets/<name>`), so the APK
 * does not carry them. Integrity comes from the SHA-256 sent inside the encrypted `host.hello`.
 */
export const ASSET_WHITELIST = ['mermaid.min.js'] as const
export type AssetName = (typeof ASSET_WHITELIST)[number]
export type AssetInfo = { name: string; sha256: string; size: number }

export class AssetStore {
  private readonly cache = new Map<string, { info: AssetInfo; body: Buffer }>()

  constructor(private readonly port: RemoteHostPort) {}

  async load(name: string): Promise<{ info: AssetInfo; body: Buffer } | null> {
    if (!(ASSET_WHITELIST as readonly string[]).includes(name)) return null
    const hit = this.cache.get(name)
    if (hit) return hit
    const path = this.port.assetPath(name)
    if (!path) return null
    try {
      const body = await readFile(path)
      const info = { name, sha256: createHash('sha256').update(body).digest('hex'), size: body.length }
      const entry = { info, body }
      this.cache.set(name, entry)
      return entry
    } catch {
      return null
    }
  }

  /** Infos of assets already loaded or loadable now (computed once at gateway start). */
  async warm(): Promise<void> {
    await Promise.all(ASSET_WHITELIST.map((n) => this.load(n)))
  }

  infos(): AssetInfo[] {
    return [...this.cache.values()].map((e) => e.info)
  }
}
