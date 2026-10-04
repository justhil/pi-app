import { describe, expect, it } from 'vitest'
import {
  browserAcceptLanguages,
  chromeSecChUa,
  greaseBrand,
  withChromeClientHints,
  chromeUserAgent,
  dedupeLanguages,
  isAllowedBrowserUrl,
  isExternalProtocolUrl,
  normalizeAddressInput,
  browserSearchUrl,
} from './browser-types'

describe('normalizeAddressInput', () => {
  it('keeps explicit http(s) URLs', () => {
    expect(normalizeAddressInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeAddressInput('  http://example.com ')).toBe('http://example.com')
  })

  it('adds https to bare domains and http to loopback / IPs', () => {
    expect(normalizeAddressInput('github.com')).toBe('https://github.com')
    expect(normalizeAddressInput('docs.example.co.uk/path')).toBe('https://docs.example.co.uk/path')
    expect(normalizeAddressInput('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeAddressInput('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x')
    expect(normalizeAddressInput('192.168.1.10')).toBe('http://192.168.1.10')
  })

  it('turns everything else into a search', () => {
    expect(normalizeAddressInput('pi desktop')).toBe('https://www.bing.com/search?q=pi%20desktop')
    expect(normalizeAddressInput('hello', 'https://s.test/?q=')).toBe('https://s.test/?q=hello')
    expect(normalizeAddressInput('javascript:alert(1)')).toMatch(/^https:\/\/www\.bing\.com\/search\?q=/)
  })

  it('maps empty input to about:blank', () => {
    expect(normalizeAddressInput('   ')).toBe('about:blank')
  })
})

describe('browserSearchUrl', () => {
  it('maps known engines and falls back to Bing', () => {
    expect(browserSearchUrl('baidu')).toBe('https://www.baidu.com/s?wd=')
    expect(browserSearchUrl('nope')).toBe('https://www.bing.com/search?q=')
    expect(browserSearchUrl(undefined)).toBe('https://www.bing.com/search?q=')
  })
})

describe('isAllowedBrowserUrl', () => {
  it('allows only http(s) and about:blank', () => {
    expect(isAllowedBrowserUrl('https://a.test')).toBe(true)
    expect(isAllowedBrowserUrl('http://localhost:3000')).toBe(true)
    expect(isAllowedBrowserUrl('about:blank')).toBe(true)
    for (const url of ['file:///etc/passwd', 'chrome://settings', 'devtools://x', 'javascript:alert(1)', 'data:text/html,x', 'nonsense']) {
      expect(isAllowedBrowserUrl(url)).toBe(false)
    }
  })
})

describe('isExternalProtocolUrl', () => {
  it('detects schemes handed to the OS', () => {
    expect(isExternalProtocolUrl('mailto:a@b.c')).toBe(true)
    expect(isExternalProtocolUrl('https://a.test')).toBe(false)
    expect(isExternalProtocolUrl('file:///x')).toBe(false)
  })
})

describe('languages', () => {
  it('dedupes case-insensitively, keeping first spelling', () => {
    expect(dedupeLanguages(['zh-CN', 'zh', 'zh', 'ZH-cn', 'en'])).toEqual(['zh-CN', 'zh', 'en'])
  })

  it('expands region variants with their base once', () => {
    expect(browserAcceptLanguages(['zh-CN', 'zh', 'en-US'])).toEqual(['zh-CN', 'zh', 'en-US', 'en'])
    expect(browserAcceptLanguages(['zh-CN', 'zh-TW'])).toEqual(['zh-CN', 'zh', 'zh-TW'])
    expect(browserAcceptLanguages([])).toEqual(['en-US', 'en'])
  })
})

describe('user agent', () => {
  it('builds a Chrome UA without Electron tokens', () => {
    const ua = chromeUserAgent('150', 'linux')
    expect(ua).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36')
    expect(chromeUserAgent('150', 'win32')).toContain('Windows NT 10.0')
    expect(ua).not.toMatch(/Electron/)
  })

  it('mirrors the brands pages see in navigator.userAgentData (no extra "Google Chrome")', () => {
    // Engine E on Chromium 150 reports exactly this list to JS.
    expect(chromeSecChUa(undefined, '150')).toBe('"Not;A=Brand";v="8", "Chromium";v="150"')
    expect(chromeSecChUa('"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"', '150')).toBe('"Not;A=Brand";v="8", "Chromium";v="150"')
    expect(greaseBrand('150')).toBe('"Not;A=Brand";v="8"')
  })

  it('adds client hints to https requests only, keeping existing ones', () => {
    expect(withChromeClientHints('http://localhost/', { a: '1' }, '150', 'linux')).toEqual({ a: '1' })
    const out = withChromeClientHints('https://x.test/', { 'Sec-CH-UA-Mobile': '?1' }, '150', 'win32')
    expect(out['sec-ch-ua']).toBe('"Not;A=Brand";v="8", "Chromium";v="150"')
    expect(out['Sec-CH-UA-Mobile']).toBe('?1')
    expect(out['sec-ch-ua-mobile']).toBeUndefined()
    expect(out['sec-ch-ua-platform']).toBe('"Windows"')
  })
})
