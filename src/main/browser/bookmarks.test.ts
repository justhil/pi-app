import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addBookmark,
  configureBookmarks,
  importHtmlBookmarks,
  listBookmarks,
  removeBookmark,
  updateBookmark,
} from './bookmarks'

let dir = ''

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = ''
  }
})

describe('browser bookmarks persistence & HTML import', () => {
  it('adds, deduplicates, updates, removes, and rejects unsafe schemes', () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-bm-test-'))
    configureBookmarks(join(dir, 'bookmarks.json'))

    addBookmark({ url: 'https://github.com/justhiL/pi-app', title: 'pi-app' })
    addBookmark({ url: 'javascript:alert(1)', title: 'bad' })
    expect(listBookmarks()).toHaveLength(1)
    expect(listBookmarks()[0].title).toBe('pi-app')

    const id = listBookmarks()[0].id
    updateBookmark(id, { title: 'Pi Desktop Repo', folder: 'Dev' })
    expect(listBookmarks()[0].title).toBe('Pi Desktop Repo')
    expect(listBookmarks()[0].folder).toBe('Dev')

    // Re-read from disk cleanly
    configureBookmarks(join(dir, 'bookmarks.json'))
    expect(listBookmarks()[0].title).toBe('Pi Desktop Repo')

    removeBookmark({ id })
    expect(listBookmarks()).toHaveLength(0)
  })

  it('imports Chrome/Edge Netscape HTML bookmarks while preserving folder names and deduplicating', () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-bm-html-'))
    configureBookmarks(join(dir, 'bookmarks.json'))

    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><H3>Frontend</H3>
        <DL><p>
          <DT><A HREF="https://react.dev">React Docs</A>
          <DT><A HREF="https://vitejs.dev">Vite</A>
          <DT><A HREF="chrome://settings">Ignored Internal</A>
        </DL><p>
      </DL><p>`
    const res = importHtmlBookmarks(html)
    expect(res.added).toBe(2)
    expect(res.bookmarks.map((b) => [b.folder, b.title])).toEqual([
      ['Frontend', 'React Docs'],
      ['Frontend', 'Vite'],
    ])

    const again = importHtmlBookmarks(html)
    expect(again.added).toBe(0)
  })
})
