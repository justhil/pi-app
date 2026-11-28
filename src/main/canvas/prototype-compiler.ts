import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { transform as sucraseTransform } from 'sucrase'
import { CANVAS_REACT_RUNTIME_JS } from 'virtual:canvas-react-runtime'
import { TAILWIND_PREFLIGHT_CSS } from 'virtual:canvas-tailwind-preflight'

const nodeRequire = createRequire(import.meta.url)

export type PrototypeMode = 'html' | 'react'
export type LucideIconNode = [string, Record<string, string | number>]

export interface CompilePrototypeRequest {
  mode?: PrototypeMode
  code: string
  css?: string
  files?: Record<string, string>
  filePath?: string
  tailwind?: boolean
  includeRuntime?: boolean
}

export interface CompilePrototypeSuccess {
  ok: true
  mode: PrototypeMode
  compiledMain?: string
  compiledFiles?: Record<string, string>
  tailwindCss: string
  lucideIcons?: Record<string, LucideIconNode[]>
  runtimeJs?: string
  compileMs: number
  cached: boolean
}

export interface CompilePrototypeFailure {
  ok: false
  mode: PrototypeMode
  error: string
  file?: string
  line?: number
  column?: number
}

export type CompilePrototypeResult = CompilePrototypeSuccess | CompilePrototypeFailure

const MAX_CACHE_ENTRIES = 24
const compileCache = new Map<string, Omit<CompilePrototypeSuccess, 'runtimeJs' | 'cached'>>()

const LUCIDE_ICON_CACHE = new Map<string, LucideIconNode[] | null>()
let lucideEsmDir: string | null | undefined
let lucideIndexMapPromise: Promise<Map<string, string>> | null = null

function getLucideEsmDir(): string | null {
  if (lucideEsmDir !== undefined) return lucideEsmDir
  try {
    const pkgPath = nodeRequire.resolve('lucide-react/package.json')
    lucideEsmDir = join(dirname(pkgPath), 'dist', 'esm')
  } catch {
    lucideEsmDir = null
  }
  return lucideEsmDir
}

/** Build an exact ExportName -> icon relative path map once from `lucide-react/dist/esm/lucide-react.js` (covers all aliases). */
async function getLucideIndexMap(): Promise<Map<string, string>> {
  if (lucideIndexMapPromise) return lucideIndexMapPromise
  lucideIndexMapPromise = (async () => {
    const map = new Map<string, string>()
    const dir = getLucideEsmDir()
    if (!dir) return map
    try {
      const indexSrc = await readFile(join(dir, 'lucide-react.js'), 'utf8')
      const lineRe = /export\s*\{([^}]+)\}\s*from\s*['"](\.\/icons\/[^'"]+)['"]/g
      let match: RegExpExecArray | null
      while ((match = lineRe.exec(indexSrc)) !== null) {
        const relPath = match[2]
        for (const item of match[1].split(',')) {
          const asMatch = /\bas\s+([A-Za-z0-9_]+)/.exec(item)
          if (asMatch?.[1]) map.set(asMatch[1], relPath)
        }
      }
    } catch {
      /* ignore missing index */
    }
    return map
  })()
  return lucideIndexMapPromise
}

/** Auto-detect whether a prototype payload should run as React (JSX/TSX) or plain HTML. */
export function detectPrototypeMode(req: {
  mode?: PrototypeMode
  code: string
  filePath?: string
  files?: Record<string, string>
}): PrototypeMode {
  if (req.mode === 'react' || req.mode === 'html') return req.mode
  const fp = (req.filePath ?? '').trim().toLowerCase()
  if (fp.endsWith('.tsx') || fp.endsWith('.jsx')) return 'react'
  if (fp.endsWith('.html') || fp.endsWith('.htm')) return 'html'
  if (req.files && Object.keys(req.files).some((k) => /\.(?:tsx|jsx|ts|js)$/i.test(k))) {
    return 'react'
  }
  const trimmed = req.code.trim()
  if (!trimmed) return 'html'
  if (/^<!doctype\s+html|^<html[\s>]/i.test(trimmed)) return 'html'
  if (
    /import\s+[\s\S]*?from\s+['"](?:react|lucide-react)['"]/.test(trimmed) ||
    /export\s+default\s+(?:function|class|const|\()/.test(trimmed) ||
    /\buse(?:State|Effect|Memo|Callback|Ref|Reducer)\s*(?:<[^>]*>)?\s*\(/.test(trimmed) ||
    /\bReact\.createElement\b/.test(trimmed)
  ) {
    return 'react'
  }
  return 'html'
}

/** Normalize relative module paths inside virtual `files` maps to `./name` (without extension). */
export function normalizeVirtualModulePath(rawPath: string): string {
  let clean = rawPath.replace(/\\/g, '/').trim()
  if (!clean.startsWith('./') && !clean.startsWith('/')) clean = `./${clean}`
  if (clean.startsWith('/')) clean = `.${clean}`
  return clean.replace(/\.(?:tsx|ts|jsx|js|mjs)$/i, '')
}

/** Extract all named identifiers imported from `lucide-react` across user files. */
export function extractLucideImports(sources: readonly string[]): string[] {
  const names = new Set<string>()
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g
  for (const src of sources) {
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(src)) !== null) {
      const specifiers = match[1].split(',')
      for (const spec of specifiers) {
        const cleaned = spec.replace(/^\s*type\s+/, '').trim()
        if (!cleaned) continue
        const imported = cleaned.split(/\s+as\s+/)[0]?.trim()
        if (imported && /^[A-Z][A-Za-z0-9]*$/.test(imported)) {
          names.add(imported)
        }
      }
    }
  }
  return [...names]
}

function toLucideKebabCandidates(iconName: string): string[] {
  const base = iconName.endsWith('Icon') && iconName.length > 4 ? iconName.slice(0, -4) : iconName
  const c1 = base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase()
  const c2 = base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return c1 === c2 ? [c1] : [c1, c2]
}

/** Parse the static `createLucideIcon("Name", [...])` SVG node list safely without eval. */
export function parseLucideIconSource(esmSource: string): LucideIconNode[] | null {
  const start = esmSource.indexOf('createLucideIcon(')
  if (start < 0) return null
  const arrStart = esmSource.indexOf('[', start)
  const arrEnd = esmSource.lastIndexOf(']')
  if (arrStart < 0 || arrEnd <= arrStart) return null
  const arrayBody = esmSource.slice(arrStart, arrEnd + 1)
  // Convert JS object-literal keys (`d:`, `cx:`, `key:`) inside the static lucide icon definition to valid JSON.
  const jsonText = arrayBody
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, '$1')
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!Array.isArray(parsed)) return null
    const valid: LucideIconNode[] = []
    for (const row of parsed) {
      if (
        Array.isArray(row) &&
        typeof row[0] === 'string' &&
        row[1] != null &&
        typeof row[1] === 'object' &&
        !Array.isArray(row[1])
      ) {
        const attrs: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(row[1] as Record<string, unknown>)) {
          if (k === 'key') continue
          if (typeof v === 'string' || typeof v === 'number') attrs[k] = v
        }
        valid.push([row[0], attrs])
      }
    }
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

async function loadLucideIconNode(iconName: string): Promise<LucideIconNode[] | null> {
  if (LUCIDE_ICON_CACHE.has(iconName)) return LUCIDE_ICON_CACHE.get(iconName) ?? null
  const dir = getLucideEsmDir()
  if (!dir) return null
  const indexMap = await getLucideIndexMap()
  const mappedRel = indexMap.get(iconName)
  const candidates: string[] = mappedRel
    ? [join(dir, mappedRel)]
    : toLucideKebabCandidates(iconName).map((kebab) => join(dir, 'icons', `${kebab}.js`))

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, 'utf8')
      const parsed = parseLucideIconSource(content)
      if (parsed) {
        LUCIDE_ICON_CACHE.set(iconName, parsed)
        return parsed
      }
    } catch {
      /* try next candidate */
    }
  }
  LUCIDE_ICON_CACHE.set(iconName, null)
  return null
}

function parseSucraseError(err: unknown): { message: string; line?: number; column?: number } {
  const e = err as { message?: string; loc?: { line?: number; column?: number } }
  const msg = e?.message || String(err)
  const line = e?.loc?.line ?? Number(/\((\d+):(\d+)\)/.exec(msg)?.[1] || 0)
  const column = e?.loc?.column ?? Number(/\((\d+):(\d+)\)/.exec(msg)?.[2] || 0)
  return {
    message: msg,
    line: line > 0 ? line : undefined,
    column: column > 0 ? column : undefined,
  }
}

async function compileTailwindCss(
  rawSources: { raw: string; extension: string }[],
  includePreflight: boolean,
): Promise<string> {
  const result = await postcss([
    tailwindcss({
      darkMode: 'class',
      content: rawSources,
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind components;\n@tailwind utilities;', { from: undefined })
  const utilCss = result.css.trim()
  if (!utilCss && !includePreflight) return ''
  return includePreflight ? `${TAILWIND_PREFLIGHT_CSS}\n${utilCss}` : utilCss
}

function cacheSet(key: string, value: Omit<CompilePrototypeSuccess, 'runtimeJs' | 'cached'>): void {
  compileCache.delete(key)
  compileCache.set(key, value)
  if (compileCache.size > MAX_CACHE_ENTRIES) {
    const oldest = compileCache.keys().next().value
    if (oldest) compileCache.delete(oldest)
  }
}

export async function compilePrototype(req: CompilePrototypeRequest): Promise<CompilePrototypeResult> {
  const startedAt = Date.now()
  const mode = detectPrototypeMode({
    mode: req.mode,
    code: req.code,
    filePath: req.filePath,
    files: req.files,
  })
  const useTailwind = req.tailwind !== false

  const cacheKey = createHash('sha1')
    .update(JSON.stringify({ mode, code: req.code, css: req.css ?? '', files: req.files ?? null, useTailwind }))
    .digest('base64url')

  const cached = compileCache.get(cacheKey)
  if (cached) {
    return {
      ...cached,
      ...(mode === 'react' && req.includeRuntime !== false ? { runtimeJs: CANVAS_REACT_RUNTIME_JS } : {}),
      cached: true,
    }
  }

  const allFileEntries = Object.entries(req.files ?? {})
  const tailwindSources: { raw: string; extension: string }[] = [
    { raw: req.code, extension: mode === 'react' ? 'tsx' : 'html' },
    ...allFileEntries.map(([name, body]) => ({
      raw: body,
      extension: name.endsWith('.html') ? 'html' : 'tsx',
    })),
  ]

  if (mode === 'html') {
    const tailwindCss = useTailwind ? await compileTailwindCss(tailwindSources, false) : ''
    const out: Omit<CompilePrototypeSuccess, 'runtimeJs' | 'cached'> = {
      ok: true,
      mode: 'html',
      tailwindCss,
      compileMs: Date.now() - startedAt,
    }
    cacheSet(cacheKey, out)
    return { ...out, cached: false }
  }

  // React JSX/TSX offline transform via Sucrase
  let compiledMain: string
  try {
    compiledMain = sucraseTransform(req.code, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
      production: true,
      filePath: req.filePath || 'App.tsx',
    }).code
  } catch (err) {
    const parsed = parseSucraseError(err)
    return {
      ok: false,
      mode: 'react',
      file: req.filePath || 'App.tsx',
      error: parsed.message,
      line: parsed.line,
      column: parsed.column,
    }
  }

  const compiledFiles: Record<string, string> = {}
  for (const [rawName, body] of allFileEntries) {
    const normKey = normalizeVirtualModulePath(rawName)
    try {
      compiledFiles[normKey] = sucraseTransform(body, {
        transforms: ['typescript', 'jsx', 'imports'],
        jsxRuntime: 'classic',
        production: true,
        filePath: rawName,
      }).code
    } catch (err) {
      const parsed = parseSucraseError(err)
      return {
        ok: false,
        mode: 'react',
        file: rawName,
        error: parsed.message,
        line: parsed.line,
        column: parsed.column,
      }
    }
  }

  const iconNames = extractLucideImports([req.code, ...allFileEntries.map(([, v]) => v)])
  const [tailwindCss, resolvedIcons] = await Promise.all([
    useTailwind ? compileTailwindCss(tailwindSources, true) : Promise.resolve(''),
    Promise.all(iconNames.map(async (name) => [name, await loadLucideIconNode(name)] as const)),
  ])

  const lucideIcons: Record<string, LucideIconNode[]> = {}
  for (const [name, node] of resolvedIcons) {
    if (node) lucideIcons[name] = node
  }

  const out: Omit<CompilePrototypeSuccess, 'runtimeJs' | 'cached'> = {
    ok: true,
    mode: 'react',
    compiledMain,
    compiledFiles,
    tailwindCss,
    lucideIcons,
    compileMs: Date.now() - startedAt,
  }
  cacheSet(cacheKey, out)

  return {
    ...out,
    ...(req.includeRuntime !== false ? { runtimeJs: CANVAS_REACT_RUNTIME_JS } : {}),
    cached: false,
  }
}
