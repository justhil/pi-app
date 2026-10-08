import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.generated.ts') ? [p] : []
  })
}

// The DevTools protocol is attached for agent tabs only, through cdp/ (2026-10-08: effect over
// the old no-CDP rule). Pages can detect Runtime.enable, so no code may send it; no remote port.
describe('browser DevTools protocol use', () => {
  const files = sources(__dirname)

  it('touches webContents.debugger only in cdp/ (chrome/ relays chrome.debugger of the user browser)', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = relative(__dirname, file).replace(/\\/g, '/')
      if (rel.startsWith('cdp/') || rel.startsWith('chrome/')) continue
      expect(readFileSync(file, 'utf8'), rel).not.toMatch(/\.debugger\b|remote-debugging/)
    }
  })

  it('never sends Runtime.enable', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/send\w*\(\s*['"]Runtime\.enable/)
    }
  })
})
