import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeDownloadName, uniqueDownloadPath } from './download-path'

describe('download path', () => {
  it('keeps names inside the target directory', () => {
    expect(sanitizeDownloadName('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(sanitizeDownloadName('a\\b.txt')).toBe('a_b.txt')
    expect(sanitizeDownloadName('')).toBe('download')
    expect(sanitizeDownloadName('..')).toBe('download')
  })

  it('never overwrites existing files', () => {
    const taken = new Set([join('/d', 'report.pdf'), join('/d', 'report (1).pdf')])
    expect(uniqueDownloadPath('/d', 'report.pdf', (p) => taken.has(p))).toBe(join('/d', 'report (2).pdf'))
    expect(uniqueDownloadPath('/d', 'notes', () => false)).toBe(join('/d', 'notes'))
  })
})
