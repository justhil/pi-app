import { describe, expect, it, vi } from 'vitest'
import {
  compilePrototype,
  detectPrototypeMode,
  extractLucideImports,
  normalizeVirtualModulePath,
} from '../prototype-compiler'
import { parseSvgDimensions } from '../svg-png-exporter'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

describe('Offline React/TSX + Tailwind prototype compiler', () => {
  it('auto-detects react vs html mode reliably', () => {
    expect(detectPrototypeMode({ code: '<!doctype html><html><body>Hi</body></html>' })).toBe('html')
    expect(detectPrototypeMode({ code: '<div class="p-4">Hello</div>' })).toBe('html')
    expect(detectPrototypeMode({ code: 'export default function App() { return <div /> }' })).toBe('react')
    expect(detectPrototypeMode({ code: 'const x = 1', filePath: 'demo/Card.tsx' })).toBe('react')
    expect(detectPrototypeMode({ code: '<div>Hi</div>', mode: 'react' })).toBe('react')
  })

  it('extracts named lucide-react icon imports and normalizes virtual file paths', () => {
    const names = extractLucideImports([
      `import { Sparkles, ArrowRight as NextIcon, type LucideProps } from 'lucide-react'`,
      `import { CheckCircle2 } from "lucide-react"`,
    ])
    expect(names.sort()).toEqual(['ArrowRight', 'CheckCircle2', 'LucideProps', 'Sparkles'])
    expect(normalizeVirtualModulePath('components/Badge.tsx')).toBe('./components/Badge')
    expect(normalizeVirtualModulePath('/Card.jsx')).toBe('./Card')
  })

  it('compiles TSX + multi-file imports + real Tailwind v3 JIT + on-demand lucide icons offline with LRU cache', async () => {
    const code = `
import React, { useState } from 'react'
import { Sparkles, CheckCircle2 } from 'lucide-react'
import { Badge } from './Badge'

export default function App() {
  const [n, setN] = useState<number>(1)
  return (
    <div className="min-h-screen bg-[#1a2b3c] dark:bg-zinc-950 p-6 grid grid-cols-[120px_1fr]">
      <Badge label={String(n)} />
      <button onClick={() => setN((v) => v + 1)} className="hover:bg-emerald-500/20 rounded-xl px-3 py-1.5">
        <Sparkles size={16} />
        <CheckCircle2 size={16} />
      </button>
    </div>
  )
}
`
    const files = {
      './Badge.tsx': `export function Badge({ label }: { label: string }) { return <span className="text-amber-300 font-mono">{label}</span> }`,
    }

    const first = await compilePrototype({ code, files, tailwind: true, includeRuntime: true })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.mode).toBe('react')
    expect(first.cached).toBe(false)
    expect(first.compiledMain).toContain('.createElement')
    expect(first.compiledFiles?.['./Badge']).toContain('.createElement')
    expect(first.tailwindCss).toContain('#1a2b3c')
    expect(first.tailwindCss).toContain('120px 1fr')
    expect(first.tailwindCss).toContain('.dark')
    expect(first.tailwindCss).toContain('text-amber-300')
    expect(first.lucideIcons?.Sparkles?.length).toBeGreaterThan(0)
    expect(first.lucideIcons?.CheckCircle2?.length).toBeGreaterThan(0)
    expect(first.runtimeJs).toContain('__PI_CANVAS_RUNTIME__')

    // Second identical call hits LRU cache instantly.
    const second = await compilePrototype({ code, files, tailwind: true, includeRuntime: false })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.cached).toBe(true)
    expect(second.runtimeJs).toBeUndefined()
  })

  it('reports line-numbered syntax errors cleanly when TSX fails to parse', async () => {
    const broken = `import React from 'react'\nexport default function App() {\n  return <div className="p-4">unclosed\n}`
    const res = await compilePrototype({ code: broken, mode: 'react' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.length).toBeGreaterThan(0)
    expect(res.line).toBeGreaterThan(0)
  })
})

describe('SVG PNG exporter dimension parser', () => {
  it('parses viewBox and explicit width/height with safe clamping', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 640 360"></svg>')).toEqual({ width: 640, height: 360 })
    expect(parseSvgDimensions('<svg width="420px" height="210px"></svg>')).toEqual({ width: 420, height: 210 })
    expect(parseSvgDimensions('<svg viewBox="0 0 99999 10"></svg>')).toEqual({ width: 4096, height: 32 })
  })
})
