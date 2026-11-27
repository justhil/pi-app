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

  it('resolves relative share images against the first valid <base href> in head while keeping the page URL', () => {
    const html = `<head>
      <!-- <base href="https://comment.example.com/"> -->
      <script>const s = '<base href="https://script.example.com/">'</script>
      <base target="_blank">
      <base href="https://cdn.example.com/assets/">
      <base href="https://second.example.com/ignored/">
      <meta property="og:image" content="share.png?a=1&amp;b=2">
    </head><base href="https://body.example.com/">`
    expect(parseLinkPreview(html, 'https://example.com/articles/post')).toEqual({
      url: 'https://example.com/articles/post',
      title: undefined,
      description: undefined,
      imageUrl: 'https://cdn.example.com/assets/share.png?a=1&b=2',
    })
    expect(parseLinkPreview('<head><base href="/media/"><meta property="og:image" content="card.png"></head>', 'https://example.com/articles/post'))
      .toMatchObject({ url: 'https://example.com/articles/post', imageUrl: 'https://example.com/media/card.png' })
    expect(parseLinkPreview('<head><base href="javascript:alert(1)"><meta property="og:image" content="/fallback.png"></head>', 'https://example.com/page'))
      .toMatchObject({ url: 'https://example.com/page', imageUrl: 'https://example.com/fallback.png' })
    expect(parseLinkPreview('<head><base href="https://user:pass@evil.example/a/"><meta property="og:image" content="card.png"></head>', 'https://example.com/page'))
      .toMatchObject({ url: 'https://example.com/page', imageUrl: 'https://example.com/card.png' })
  })

  it('decodes non-UTF-8 pages from Content-Type charset, <meta charset>, http-equiv, and BOM', async () => {
    respond([{ type: 'text/html; charset=shift_jis', body: Buffer.concat([Buffer.from('<title>'), Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), Buffer.from('</title></head>')]) }])
    expect(await getLinkPreview('https://example.com/charset-shift-jis')).toMatchObject({ title: '日本語' })

    respond([{ type: 'text/html', body: Buffer.concat([Buffer.from('<meta charset="gbk"><title>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</title></head>')]) }])
    expect(await getLinkPreview('https://example.com/charset-gbk')).toMatchObject({ title: '中文' })

    respond([{ type: 'text/html', body: Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=big5"><title>'), Buffer.from([0xc1, 0x63, 0xc5, 0xe9]), Buffer.from('</title></head>')]) }])
    expect(await getLinkPreview('https://example.com/charset-big5')).toMatchObject({ title: '繁體' })

    respond([{ type: 'text/html; charset=not-a-real-charset', body: Buffer.concat([Buffer.from('<meta charset="euc-kr"><title>'), Buffer.from([0xc7, 0xd1, 0xb1, 0xb9, 0xbe, 0xee]), Buffer.from('</title></head>')]) }])
    expect(await getLinkPreview('https://example.com/charset-euc-kr')).toMatchObject({ title: '한국어' })

    respond([{ type: 'text/html; charset=shift_jis', body: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<title>中文</title></head>', 'utf16le')]) }])
    expect(await getLinkPreview('https://example.com/charset-utf16le-bom')).toMatchObject({ title: '中文' })

    respond([{ type: 'text/html', body: Buffer.from('<!-- <meta charset="gbk"> --><meta charset="utf-16"><title>中文 UTF-8</title></head>', 'utf8') }])
    expect(await getLinkPreview('https://example.com/charset-utf8-meta-edge')).toMatchObject({ title: '中文 UTF-8' })
  })

  it('fetches share images resolved against <base href> and keeps valid og:type=image HTML pages', async () => {
    respond([
      { body: '<head><base href="https://cdn.example.com/assets/"><meta property="og:type" content="image"><meta property="og:title" content="Photo"><meta property="og:image" content="share.png"></head>' },
      { type: 'image/png', body: Buffer.from([1]) },
    ])
    expect(await getLinkPreview('https://example.com/base-href-fetch')).toEqual({
      url: 'https://example.com/base-href-fetch',
      title: 'Photo',
      description: undefined,
      image: 'data:image/png;base64,AQ==',
    })
    expect(mocks.fetch.mock.calls[1][0]).toBe('https://cdn.example.com/assets/share.png')

    respond([{ body: '<head><base href="http://127.0.0.1/internal/"><meta property="og:title" content="Safe"><meta property="og:image" content="secret.png"></head>' }])
    const privateBase = await getLinkPreview('https://example.com/base-href-private')
    expect(privateBase.title).toBe('Safe')
    expect(privateBase.image).toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
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
