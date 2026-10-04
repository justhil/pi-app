import { describe, expect, it } from 'vitest'
import { aria2InputFile, parseReadout, parseSize } from './aria2-readout'

describe('aria2 readout', () => {
  it('parses binary sizes', () => {
    expect(parseSize('400.0KiB')).toBe(409600)
    expect(parseSize('1.5MiB')).toBe(1572864)
    expect(parseSize('12B')).toBe(12)
    expect(parseSize('?')).toBe(0)
  })
  it('takes the latest readout from a chunk', () => {
    const chunk = '\r[#2089b0 400.0KiB/33.2MiB(1%) CN:1 DL:115.7KiB ETA:4m51s]\r[#2089b0 8.0MiB/33.2MiB(24%) CN:16 DL:15.7MiB ETA:2s]'
    expect(parseReadout(chunk)).toEqual({ received: 8388608, total: 34812723, connections: 16, speed: 16462643 })
    expect(parseReadout('no progress here')).toBeNull()
  })
  it('builds a stdin input file without line breaks leaking into options', () => {
    const f = aria2InputFile({ url: 'https://x.test/f.zip', dir: '/d', out: 'f.zip', headers: { Cookie: 'a=1; b=2', Referer: 'https://x.test/\nevil=1' } })
    expect(f).toBe('https://x.test/f.zip\n  dir=/d\n  out=f.zip\n  header=Cookie: a=1; b=2\n  header=Referer: https://x.test/ evil=1\n')
  })
})
