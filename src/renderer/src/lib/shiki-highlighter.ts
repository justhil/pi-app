import type { HighlighterCore } from 'shiki/core'

let highlighter: HighlighterCore | null = null
let loadPromise: Promise<HighlighterCore> | null = null

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
}

function guessLangFromPath(path: string): string | undefined {
  const match = path.match(/\.([a-zA-Z0-9]+)$/)
  if (!match) return undefined
  const extension = match[1].toLowerCase()
  return LANG_ALIASES[extension] || extension
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/**
 * Explicit language/theme load via shiki/core — avoids the full grammar/theme bundle.
 * Unsupported languages fall back to escaped plain text.
 */
async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter
  if (!loadPromise) {
    loadPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/oniguruma'),
      ])
      const [githubLight, githubDark, typescript, javascript, json, bash, yaml, markdown, wasm] =
        await Promise.all([
          import('shiki/themes/github-light.mjs'),
          import('shiki/themes/github-dark.mjs'),
          import('shiki/langs/typescript.mjs'),
          import('shiki/langs/javascript.mjs'),
          import('shiki/langs/json.mjs'),
          import('shiki/langs/bash.mjs'),
          import('shiki/langs/yaml.mjs'),
          import('shiki/langs/markdown.mjs'),
          import('shiki/wasm'),
        ])
      const instance = await createHighlighterCore({
        themes: [githubLight.default, githubDark.default],
        langs: [
          typescript.default,
          javascript.default,
          json.default,
          bash.default,
          yaml.default,
          markdown.default,
        ],
        engine: createOnigurumaEngine(wasm),
      })
      highlighter = instance
      return instance
    })()
  }
  return loadPromise
}

/** Highlight code to HTML; falls back to escaped plain text on failure. */
export async function highlightCodeToHtml(code: string, lang?: string): Promise<string> {
  const trimmed = code.replace(/\n$/, '')
  if (!trimmed) return ''
  const resolved = lang ? LANG_ALIASES[lang] || lang : 'text'
  try {
    const instance = await getHighlighter()
    const loadedLanguages = instance.getLoadedLanguages() as string[]
    const useLanguage = loadedLanguages.includes(resolved) ? resolved : 'text'
    const theme = isDark() ? 'github-dark' : 'github-light'
    if (useLanguage === 'text') {
      return escapeHtml(trimmed)
    }
    return instance.codeToHtml(trimmed, {
      lang: useLanguage,
      theme: theme as 'github-dark' | 'github-light',
    })
  } catch {
    return escapeHtml(trimmed)
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export { guessLangFromPath }
