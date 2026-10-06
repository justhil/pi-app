import { describe, expect, it } from 'vitest'
import { parseTailnetName } from '../tailnet'

describe('parseTailnetName', () => {
  it('reads the MagicDNS name of a running node', () => {
    expect(parseTailnetName(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'Desk-PC.tail1234.ts.net.' } }))).toBe('desk-pc.tail1234.ts.net')
  })
  it('ignores stopped nodes, foreign names and junk', () => {
    expect(parseTailnetName(JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'pc.tail1234.ts.net.' } }))).toBeNull()
    expect(parseTailnetName(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.example.com.' } }))).toBeNull()
    expect(parseTailnetName('not json')).toBeNull()
  })
})
