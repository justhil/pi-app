import { createHighlighter, type Highlighter } from 'shiki'

let highlighter: Highlighter | null = null
let loadPromise: Promise<Highlighter> | null = null

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
}

function guessLangFromPath(path: string): string | undefined {
  const m = path.match(/\.([a-zA-Z0-9]+)$/)
  if (!m) return undefined
  const ext = m[1].toLowerCase()
  return LANG_ALIASES[ext] || ext
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter
  if (!loadPromise) {
    loadPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [
        'typescript',
        'tsx',
        'javascript',
        'jsx',
        'json',
        'python',
        'rust',
        'go',
        'bash',
        'shell',
        'yaml',
        'markdown',
        'css',
        'html',
        'sql',
        'xml',
      ],
    }).then((h) => {
      highlighter = h
      return h
    })
  }
  return loadPromise
}

/** Highlight code to HTML; falls back to escaped plain text on failure. */
export async function highlightCodeToHtml(code: string, lang?: string): Promise<string> {
  const trimmed = code.replace(/\n$/, '')
  if (!trimmed) return ''
  const resolved = lang ? (LANG_ALIASES[lang] || lang) : 'text'
  try {
    const h = await getHighlighter()
    const loaded = h.getLoadedLanguages()
    const useLang = loaded.includes(resolved as any) ? resolved : 'text'
    const theme = isDark() ? 'github-dark' : 'github-light'
    if (useLang === 'text') {
      return escapeHtml(trimmed)
    }
    return h.codeToHtml(trimmed, { lang: useLang as any, theme })
  } catch {
    return escapeHtml(trimmed)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export { guessLangFromPath }