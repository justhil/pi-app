import { net } from 'electron'
import { BlockList, isIP } from 'node:net'
import { preview } from 'linkpeek'
import type { LinkPreview } from '@shared/link-preview'

const privateAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateAddresses.addSubnet(address, prefix)
const publicIPv6 = new BlockList()
publicIPv6.addSubnet('2000::', 3, 'ipv6')

export function isPublicPreviewAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !privateAddresses.check(address, 'ipv4')
  return family === 6 && publicIPv6.check(address, 'ipv6')
    && !address.startsWith('2001:0:') && !address.startsWith('2002:')
}

export function isWebLink(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

/** Reject non-web, local and private destinations, checking DNS with Chromium's resolver. */
async function assertPublicPreviewUrl(value: string): Promise<URL> {
  if (!isWebLink(value)) throw new Error('Invalid preview URL')
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || (isIP(hostname) && !isPublicPreviewAddress(hostname))) throw new Error('Private preview URL')
  const { endpoints } = await net.resolveHost(hostname)
  if (!endpoints.length || endpoints.some(({ address }) => !isPublicPreviewAddress(address))) throw new Error('Private preview address')
  return url
}

/** linkpeek fetches through Chromium's network stack and calls this for the page and every redirect. */
const previewFetch: typeof fetch = async (input, init) => {
  await assertPublicPreviewUrl(String(input))
  return net.fetch(String(input), { ...init, credentials: 'omit' })
}

/** Download a share image, validating every redirect. */
async function readPreviewImage(value: string, redirects = 0): Promise<{ data: Buffer; type: string }> {
  if (redirects > 3) throw new Error('Invalid preview URL')
  const url = await assertPublicPreviewUrl(value)
  const response = await net.fetch(url.href, {
    signal: AbortSignal.timeout(8000),
    credentials: 'omit',
    redirect: 'manual',
    headers: { Accept: 'image/*' },
  })
  const location = response.headers.get('location')
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    await response.body?.cancel()
    return readPreviewImage(new URL(location, url).href, redirects + 1)
  }
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!response.ok || !response.body || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(type)) {
    await response.body?.cancel()
    throw new Error('Preview unavailable')
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.length
      if (size > 2 * 1024 * 1024) throw new Error('Preview too large')
      chunks.push(Buffer.from(chunk))
    }
    return { data: Buffer.concat(chunks), type }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const previews = new Map<string, { expires: number; result: Promise<LinkPreview> }>()

export function getLinkPreview(value: string): Promise<LinkPreview> {
  const url = new URL(value)
  url.hash = ''
  const key = url.href
  const cached = previews.get(key)
  if (cached && cached.expires > Date.now()) return cached.result
  const result = (async (): Promise<LinkPreview> => {
    try {
      const page = await preview(key, { fetch: previewFetch, maxBytes: 256 * 1024, maxRedirects: 3, timeout: 8000 })
      if (page.statusCode < 200 || page.statusCode > 299 || page.mediaType === 'image') throw new Error('Preview unavailable')
      const result: LinkPreview = { url: page.url, title: page.title?.slice(0, 500), description: page.description?.slice(0, 1000) }
      if (page.image) {
        try {
          const image = await readPreviewImage(page.image)
          result.image = `data:${image.type};base64,${image.data.toString('base64')}`
        } catch { /* Keep the text preview when the share image is unavailable. */ }
      }
      return result
    } catch {
      return { url: key }
    }
  })()
  if (previews.size >= 32) previews.delete(previews.keys().next().value!)
  previews.set(key, { expires: Date.now() + 5 * 60 * 1000, result })
  return result
}
