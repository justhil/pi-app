import { describe, expect, it } from 'vitest'
import { formatEntry, NetworkLog, redactHeaders } from './network-log'

describe('NetworkLog', () => {
  it('numbers requests and reports the ones an action made', () => {
    const log = new NetworkLog()
    log.onEvent('Network.requestWillBeSent', { requestId: 'a', type: 'Image', request: { url: 'https://s.test/x.png', method: 'GET' } })
    const from = log.seq()
    log.onEvent('Network.requestWillBeSent', { requestId: 'b', type: 'Fetch', request: { url: 'https://s.test/api/login', method: 'POST', postData: '{"u":1}' } })
    log.onEvent('Network.requestWillBeSent', { requestId: 'c', type: 'Script', request: { url: 'https://cdn.test/a.js', method: 'GET' } })
    log.onEvent('Network.responseReceived', { requestId: 'b', response: { status: 401, mimeType: 'application/json', headers: { 'set-cookie': 'sid=1' } } })
    log.onEvent('Network.loadingFinished', { requestId: 'b', encodedDataLength: 120 })
    const since = log.since(from)
    expect(since.map((e) => e.id)).toEqual([2])
    expect(formatEntry(since[0], 'https://s.test').replace(/\(\d+ms\)/, '(Nms)')).toBe('#2 POST /api/login → 401 (Nms)')
    expect(log.get(2)?.postData).toBe('{"u":1}')
    expect(redactHeaders(log.get(2)?.responseHeaders)).toBe('set-cookie: [redacted]')
  })

  it('marks failures and keeps a bounded history', () => {
    const log = new NetworkLog()
    for (let i = 0; i < 305; i++) log.onEvent('Network.requestWillBeSent', { requestId: `r${i}`, type: 'XHR', request: { url: `https://s.test/${i}`, method: 'GET' } })
    log.onEvent('Network.loadingFailed', { requestId: 'r304', errorText: 'net::ERR_FAILED' })
    expect(log.get(1)).toBeUndefined()
    expect(log.recent(5, true).map((e) => e.failed)).toEqual(['net::ERR_FAILED'])
  })
})
