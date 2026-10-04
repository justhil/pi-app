import { describe, expect, it } from 'vitest'
import { describeTransport, fromForm, toForm } from './mcp-form'

describe('mcp form', () => {
  it('round-trips a stdio server', () => {
    const config = { command: 'npx', args: ['-y', 'server-fs', '.'], env: { TOKEN: '${T}' }, exposure: 'direct', timeout: 30 }
    expect(fromForm(toForm('fs', config), config)).toEqual(config)
  })

  it('round-trips an http server and keeps keys the form does not show', () => {
    const config = { url: 'https://g.test/mcp', headers: { Authorization: 'Bearer ${GH}' }, oauth: { clientId: 'x' }, toolExposure: { 'get_*': 'direct' }, enabled: false }
    expect(fromForm(toForm('gh', config), config)).toEqual(config)
  })

  it('drops the other transport and defaults when switching', () => {
    const form = { ...toForm('a', { command: 'x', args: ['1'], exposure: 'deferred' }), kind: 'http' as const, url: ' https://a.test/mcp ', exposure: 'codemode' as const }
    expect(fromForm(form, { command: 'x', args: ['1'], exposure: 'deferred', type: 'stdio' })).toEqual({ url: 'https://a.test/mcp' })
  })

  it('parses header and env lines leniently', () => {
    const form = { ...toForm('a', {}), kind: 'http' as const, url: 'https://a', headers: 'X-Key: a:b\n\nbroken\n' }
    expect(fromForm(form).headers).toEqual({ 'X-Key': 'a:b' })
  })

  it('describes transports compactly', () => {
    expect(describeTransport({ url: 'https://api.test/mcp/' })).toBe('api.test/mcp/')
    expect(describeTransport({ command: 'npx', args: ['-y', 'x'] })).toBe('npx -y x')
  })
})
