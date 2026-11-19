import { app, net } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  compactModelsDevResponse,
  type UpstreamCatalogSnapshot,
} from '@shared/models-dev-catalog'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_FILENAME = 'models-dev-catalog-cache.json'
const FRESH_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 30_000

let memoryCache: UpstreamCatalogSnapshot | null = null
let inFlightFetch: Promise<UpstreamCatalogSnapshot> | null = null

function cacheFilePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

async function readDiskCache(): Promise<UpstreamCatalogSnapshot | null> {
  try {
    const raw = await readFile(cacheFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as UpstreamCatalogSnapshot
    if (
      parsed &&
      parsed.source === 'models.dev' &&
      Array.isArray(parsed.models) &&
      typeof parsed.updatedAt === 'number'
    ) {
      return parsed
    }
  } catch {
    /* cold start or corrupt cache */
  }
  return null
}

async function writeDiskCache(snapshot: UpstreamCatalogSnapshot): Promise<void> {
  const file = cacheFilePath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify(snapshot), 'utf8')
    await rename(tmp, file)
  } catch {
    /* disk cache write is best-effort */
  }
}

async function proxyAwareFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof net?.fetch === 'function') {
    return net.fetch(url, init as Parameters<typeof net.fetch>[1])
  }
  return fetch(url, init)
}

async function fetchUpstreamNow(prev: UpstreamCatalogSnapshot | null): Promise<UpstreamCatalogSnapshot> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'pi-desktop-models-catalog/1.0',
  }
  if (prev?.etag) {
    headers['If-None-Match'] = prev.etag
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await proxyAwareFetch(MODELS_DEV_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (res.status === 304 && prev) {
      const refreshed: UpstreamCatalogSnapshot = {
        ...prev,
        updatedAt: Date.now(),
        stale: false,
        error: undefined,
      }
      memoryCache = refreshed
      void writeDiskCache(refreshed)
      return refreshed
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const raw = (await res.json()) as unknown
    const etag = res.headers.get('etag') || undefined
    const compact = compactModelsDevResponse(raw, {
      updatedAt: Date.now(),
      ...(etag ? { etag } : {}),
    })
    memoryCache = compact
    void writeDiskCache(compact)
    return compact
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (prev) {
      return {
        ...prev,
        stale: true,
        error: message,
      }
    }
    return {
      source: 'models.dev',
      updatedAt: 0,
      stale: true,
      providerCount: 0,
      modelCount: 0,
      models: [],
      providers: [],
      error: message,
    }
  } finally {
    clearTimeout(timer)
  }
}

function triggerSingleFlight(prev: UpstreamCatalogSnapshot | null): Promise<UpstreamCatalogSnapshot> {
  if (!inFlightFetch) {
    inFlightFetch = fetchUpstreamNow(prev).finally(() => {
      inFlightFetch = null
    })
  }
  return inFlightFetch
}

/**
 * Retrieve the compacted `models.dev` upstream model catalog:
 * - Fresh (< 24h) cache returns instantly from memory/disk.
 * - Stale cache returns immediately while triggering a single-flight background refresh.
 * - `force: true` or empty cache awaits a live proxy-aware fetch and falls back gracefully on error.
 */
export async function getUpstreamModelCatalog(opts?: {
  force?: boolean
}): Promise<UpstreamCatalogSnapshot> {
  const force = opts?.force === true
  if (!memoryCache) {
    memoryCache = await readDiskCache()
  }
  const cached = memoryCache

  if (!force && cached && cached.models.length > 0) {
    const age = Date.now() - cached.updatedAt
    if (age < FRESH_TTL_MS) {
      return { ...cached, stale: false, error: undefined }
    }
    // Stale-while-revalidate: instant response, silent background refresh.
    void triggerSingleFlight(cached)
    return { ...cached, stale: true }
  }

  return triggerSingleFlight(cached)
}
