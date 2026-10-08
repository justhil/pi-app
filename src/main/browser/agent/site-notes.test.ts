import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendSiteNote, configureSiteNotes, deleteSiteNotes, hostKey, listSiteNotes, readSiteNotes, siteNotesSection } from './site-notes'

configureSiteNotes(mkdtempSync(join(tmpdir(), 'site-notes-')))

describe('site notes', () => {
  it('keys by host without www and ignores non-web pages', () => {
    expect(hostKey('https://www.GitHub.com/a?b')).toBe('github.com')
    expect(hostKey('about:blank')).toBeNull()
  })

  it('appends dated notes, lists and deletes them', async () => {
    await appendSiteNote('shop.test', 'Size picker  needs hover first', new Date('2026-10-08T00:00:00Z'))
    expect(await readSiteNotes('shop.test')).toBe('- 2026-10-08: Size picker needs hover first')
    expect((await listSiteNotes()).map((n) => n.host)).toContain('shop.test')
    await deleteSiteNotes('shop.test')
    expect(await readSiteNotes('shop.test')).toBe('')
  })

  it('drops the oldest notes past 8 KB', async () => {
    for (let i = 0; i < 30; i++) await appendSiteNote('big.test', `note ${i} ${'x'.repeat(400)}`)
    const notes = await readSiteNotes('big.test')
    expect(Buffer.byteLength(notes)).toBeLessThanOrEqual(8 * 1024)
    expect(notes).toContain('note 29')
    expect(notes).not.toContain('note 0 ')
  })

  it('shows notes once per conversation and host', async () => {
    await appendSiteNote('docs.test', 'Search box is inside an iframe')
    expect(await siteNotesSection('s1', 'https://docs.test/a')).toMatch(/### Site notes \(docs\.test.*\n- .*: Search box is inside an iframe/)
    expect(await siteNotesSection('s1', 'https://docs.test/b')).toBe('')
    expect(await siteNotesSection('s2', 'https://docs.test/b')).not.toBe('')
  })

  it('rejects path tricks in host names', async () => {
    await expect(appendSiteNote('../evil', 'x')).rejects.toThrow(/bad host/)
  })
})
