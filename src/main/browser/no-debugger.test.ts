import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Engine E must never attach the DevTools protocol: no `webContents.debugger`, no remote debugging port.
describe('built-in browser engine E', () => {
  it('does not use the debugger or remote debugging', () => {
    const dir = __dirname
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text, file).not.toMatch(/\.debugger\b|remote-debugging|Runtime\.enable/)
    }
  })
})
