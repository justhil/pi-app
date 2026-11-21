import { net } from 'electron'
import { BlockList, isIP } from 'node:net'
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

/** Use Chromium's network settings and validate every page, redirect and share-image destination. */
async function readPreviewResource(value: string, image = false, redirects = 0): Promise<{ url: string; data: Buffer; type: string; contentType: string }> {
  if (!isWebLink(value) || redirects > 3) throw new Error('Invalid preview URL')
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || (isIP(hostname) && !isPublicPreviewAddress(hostname))) throw new Error('Private preview URL')
  const { endpoints } = await net.resolveHost(hostname)
  if (!endpoints.length || endpoints.some(({ address }) => !isPublicPreviewAddress(address))) throw new Error('Private preview address')

  const response = await net.fetch(url.href, {
    signal: AbortSignal.timeout(8000),
    credentials: 'omit',
    redirect: 'manual',
    headers: { Accept: image ? 'image/*' : 'text/html' },
  })
  const location = response.headers.get('location')
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    await response.body?.cancel()
    return readPreviewResource(new URL(location, url).href, image, redirects + 1)
  }
  const contentType = response.headers.get('content-type') ?? ''
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (!response.ok || !response.body || (image
    ? !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(type)
    : !['text/html', 'application/xhtml+xml'].includes(type))) {
    await response.body?.cancel()
    throw new Error('Preview unavailable')
  }
  const limit = image ? 2 * 1024 * 1024 : 256 * 1024
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  let tail = ''
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.length
      if (image && size > limit) throw new Error('Preview too large')
      chunks.push(Buffer.from(chunk))
      const text = tail + Buffer.from(chunk).toString('latin1')
      tail = text.slice(-16)
      if (!image && (size >= limit || /<\/head\s*>/i.test(text))) break
    }
    return { url: url.href, data: Buffer.concat(chunks).subarray(0, limit), type, contentType }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const CHARSET_PATTERN = /(?:^|[;\s])charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;,"']+))/i

function parseTagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = match[1].toLowerCase()
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4])
  }
  return attributes
}

function resolveEncoding(label?: string | null): string | null {
  const trimmed = label?.trim()
  if (!trimmed) return null
  try {
    return new TextDecoder(trimmed).encoding
  } catch {
    return null
  }
}

function extractCharsetParam(value?: string | null): string | null {
  if (!value) return null
  const match = value.match(CHARSET_PATTERN)
  return match ? (match[1] ?? match[2] ?? match[3]) : null
}

function extractHeadSlice(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .split(/<\/head\s*>|<body\b/i, 1)[0]
}

/** Decode HTML bytes using BOM, Content-Type charset, <meta charset>, or UTF-8 fallback. */
export function decodePreviewHtml(data: Buffer, contentType = ''): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data)
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data)
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data)
  }
  const headerEncoding = resolveEncoding(extractCharsetParam(contentType))
  if (headerEncoding) return new TextDecoder(headerEncoding).decode(data)

  const prescan = extractHeadSlice(data.subarray(0, 4096).toString('latin1'))
  for (const tag of prescan.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = parseTagAttributes(tag)
    const raw = attributes.get('charset')?.replace(/\/$/, '')
      ?? (attributes.get('http-equiv')?.toLowerCase() === 'content-type'
        ? extractCharsetParam(attributes.get('content'))
        : null)
    const encoding = resolveEncoding(raw)
    if (encoding) {
      return new TextDecoder(encoding.startsWith('utf-16') ? 'utf-8' : encoding).decode(data)
    }
  }

  return new TextDecoder('utf-8').decode(data)
}

export function parseLinkPreview(html: string, url: string): LinkPreview & { imageUrl?: string } {
  const head = extractHeadSlice(html)
  let baseUrl = url
  for (const tag of head.match(/<base\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const href = parseTagAttributes(tag).get('href')
    if (href === undefined) continue
    try {
      const resolved = new URL(href.replace(/&amp;/gi, '&'), url).href
      if (isWebLink(resolved)) baseUrl = resolved
    } catch { /* Ignore invalid <base href>. */ }
    break
  }
  const metadata = new Map<string, string>()
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = parseTagAttributes(tag)
    const key = attributes.get('property') ?? attributes.get('name')
    const value = attributes.get('content')
    if (key && value && !metadata.has(key.toLowerCase())) metadata.set(key.toLowerCase(), value)
  }
  const title = metadata.get('og:title') ?? metadata.get('twitter:title') ?? head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
  const description = metadata.get('og:description') ?? metadata.get('twitter:description') ?? metadata.get('description')
  const image = metadata.get('og:image') ?? metadata.get('twitter:image')
  let imageUrl: string | undefined
  try {
    if (image) {
      const resolved = new URL(image.replace(/&amp;/gi, '&'), baseUrl).href
      if (isWebLink(resolved)) imageUrl = resolved
    }
  } catch { /* Omit invalid images. */ }
  return { url, title: title?.trim().slice(0, 500), description: description?.trim().slice(0, 1000), imageUrl }
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
      const page = await readPreviewResource(key)
      const { imageUrl, ...preview } = parseLinkPreview(decodePreviewHtml(page.data, page.contentType), page.url)
      if (imageUrl) {
        try {
          const image = await readPreviewResource(imageUrl, true)
          preview.image = `data:${image.type};base64,${image.data.toString('base64')}`
        } catch { /* Keep the text preview when the share image is unavailable. */ }
      }
      return preview
    } catch {
      return { url: key }
    }
  })()
  if (previews.size >= 32) previews.delete(previews.keys().next().value!)
  previews.set(key, { expires: Date.now() + 5 * 60 * 1000, result })
  return result
}
