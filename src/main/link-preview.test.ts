import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), resolveHost: vi.fn() }))
vi.mock('electron', () => ({ net: mocks }))

import { getLinkPreview, isPublicPreviewAddress, isWebLink, parseLinkPreview } from './link-preview'

type ResponseFixture = { status?: number; type?: string; location?: string; body?: string | Buffer }
function respond(fixtures: ResponseFixture[]) {
  mocks.fetch.mockImplementation(async () => {
    const fixture = fixtures.shift()!
    return new Response(fixture.body, {
      status: fixture.status ?? 200,
      headers: { 'content-type': fixture.type ?? 'text/html; charset=utf-8', ...(fixture.location ? { location: fixture.location } : {}) },
    })
  })
}

beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.resolveHost.mockReset().mockResolvedValue({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] })
})

describe('Link preview', () => {
  it('extracts Open Graph metadata ahead of fallbacks and ignores scripts, comments and body tags', () => {
    expect(parseLinkPreview(`<head><title>Fallback</title>
      <!-- <meta property="og:title" content="Comment"> -->
      <script>const html = '<meta property="og:title" content="Script">'</script>
      <meta CONTENT='Real &amp; useful' PROPERTY='og:title'>
      <meta name=description content="Description > details">
      <meta property="og:image" content="/image.png?a=1&amp;b=2"></head>
      <meta property="og:title" content="Body">`, 'https://example.com/page')).toEqual({
      url: 'https://example.com/page', title: 'Real &amp; useful', description: 'Description > details',
      imageUrl: 'https://example.com/image.png?a=1&b=2',
    })
  })

  it('falls back to standard HTML title and Twitter metadata', () => {
    expect(parseLinkPreview('<title>Plain page</title><meta name="twitter:description" content="Summary">', 'https://example.com')).toMatchObject({ title: 'Plain page', description: 'Summary' })
  })

  it.each(['127.0.0.1', '10.1.1.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('rejects non-public preview addresses: %s', (address) => {
    expect(isPublicPreviewAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])('accepts public addresses: %s', (address) => {
    expect(isPublicPreviewAddress(address)).toBe(true)
  })
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.com', 'garbage'])('rejects unsafe schemes and credentials: %s', (url) => {
    expect(isWebLink(url)).toBe(false)
  })

  it('fetches a share image without credentials or referrers and caches the result across fragments', async () => {
    respond([
      { body: '<title>Page</title><meta property="og:image" content="/share.png"></head>' },
      { type: 'image/png', body: Buffer.from([1, 2, 3]) },
    ])
    const url = 'https://example.com/preview-cache-test'
    const result = await getLinkPreview(url)
    expect(result).toMatchObject({ title: 'Page', image: 'data:image/png;base64,AQID' })
    expect(await getLinkPreview(`${url}#section`)).toEqual(result)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'manual', headers: { Accept: 'text/html' } })
  })

  it('checks DNS using the same Chromium resolver and rejects mixed public/private answers', async () => {
    mocks.resolveHost.mockResolvedValue({ endpoints: [{ address: '93.184.216.34' }, { address: '127.0.0.1' }] })
    const url = 'https://example.com/preview-dns-test'
    expect(await getLinkPreview(url)).toEqual({ url })
    expect(mocks.resolveHost).toHaveBeenCalledWith('example.com')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('blocks redirects to private services and omits private share images', async () => {
    respond([{ status: 302, location: 'http://127.0.0.1/admin' }])
    const url = 'https://example.com/preview-private-redirect'
    expect(await getLinkPreview(url)).toEqual({ url })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    respond([{ body: '<title>Safe title</title><meta property="og:image" content="http://169.254.169.254/metadata"></head>' }])
    const privateImage = await getLinkPreview('https://example.com/preview-private-image')
    expect(privateImage.title).toBe('Safe title')
    expect(privateImage.image).toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('stops after the head and rejects oversized or active share images', async () => {
    respond([{ body: '<title>Small head</title></head>' + 'x'.repeat(300000) }])
    expect(await getLinkPreview('https://example.com/preview-large-page')).toMatchObject({ title: 'Small head' })
    respond([
      { body: '<title>Large image</title><meta property="og:image" content="/large.png"></head>' },
      { type: 'image/png', body: Buffer.alloc(2 * 1024 * 1024 + 1) },
    ])
    const largeImage = await getLinkPreview('https://example.com/preview-large-image')
    expect(largeImage.title).toBe('Large image')
    expect(largeImage.image).toBeUndefined()
    respond([
      { body: '<title>SVG image</title><meta property="og:image" content="/active.svg"></head>' },
      { type: 'image/svg+xml', body: '<svg></svg>' },
    ])
    const activeImage = await getLinkPreview('https://example.com/preview-active-image')
    expect(activeImage.title).toBe('SVG image')
    expect(activeImage.image).toBeUndefined()
  })
})
