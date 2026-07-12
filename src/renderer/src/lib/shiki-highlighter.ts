import type { HighlighterCore, LanguageRegistration } from 'shiki/core'

let highlighter: HighlighterCore | null = null
let loadPromise: Promise<HighlighterCore> | null = null

type LangModule = { default: LanguageRegistration | LanguageRegistration[] }

/**
 * Explicit loaders so Vite can code-split grammars (dynamic path import is unreliable).
 * Keep in sync with common workspace / agent file types.
 */
const LANG_LOADERS: Record<string, () => Promise<LangModule>> = {
  // Web / JS ecosystem
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  json5: () => import('shiki/langs/json5.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  postcss: () => import('shiki/langs/postcss.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  'angular-ts': () => import('shiki/langs/angular-ts.mjs'),
  'angular-html': () => import('shiki/langs/angular-html.mjs'),
  md: () => import('shiki/langs/markdown.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),

  // Systems / general purpose
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  julia: () => import('shiki/langs/julia.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  erlang: () => import('shiki/langs/erlang.mjs'),
  clojure: () => import('shiki/langs/clojure.mjs'),
  fsharp: () => import('shiki/langs/fsharp.mjs'),
  ocaml: () => import('shiki/langs/ocaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
  nim: () => import('shiki/langs/nim.mjs'),
  crystal: () => import('shiki/langs/crystal.mjs'),
  v: () => import('shiki/langs/v.mjs'),
  solidity: () => import('shiki/langs/solidity.mjs'),
  move: () => import('shiki/langs/move.mjs'),
  wasm: () => import('shiki/langs/wasm.mjs'),
  asm: () => import('shiki/langs/asm.mjs'),

  // Shell / ops
  bash: () => import('shiki/langs/bash.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  fish: () => import('shiki/langs/fish.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  apache: () => import('shiki/langs/apache.mjs'),
  systemd: () => import('shiki/langs/systemd.mjs'),
  'ssh-config': () => import('shiki/langs/ssh-config.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  cmake: () => import('shiki/langs/cmake.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),

  // Data / config
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  properties: () => import('shiki/langs/properties.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
  csv: () => import('shiki/langs/csv.mjs'),
  tsv: () => import('shiki/langs/tsv.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  protobuf: () => import('shiki/langs/protobuf.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  terraform: () => import('shiki/langs/terraform.mjs'),

  // Markup / docs
  latex: () => import('shiki/langs/latex.mjs'),
  tex: () => import('shiki/langs/tex.mjs'),
  bibtex: () => import('shiki/langs/bibtex.mjs'),
  rst: () => import('shiki/langs/rst.mjs'),
  asciidoc: () => import('shiki/langs/asciidoc.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  log: () => import('shiki/langs/log.mjs'),
  http: () => import('shiki/langs/http.mjs'),
  mermaid: () => import('shiki/langs/mermaid.mjs'),

  // Templates
  handlebars: () => import('shiki/langs/handlebars.mjs'),
  jinja: () => import('shiki/langs/jinja.mjs'),
  liquid: () => import('shiki/langs/liquid.mjs'),
  twig: () => import('shiki/langs/twig.mjs'),
  erb: () => import('shiki/langs/erb.mjs'),
  pug: () => import('shiki/langs/pug.mjs'),

  // Misc popular
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  'objective-cpp': () => import('shiki/langs/objective-cpp.mjs'),
  matlab: () => import('shiki/langs/matlab.mjs'),
  glsl: () => import('shiki/langs/glsl.mjs'),
  hlsl: () => import('shiki/langs/hlsl.mjs'),
  wgsl: () => import('shiki/langs/wgsl.mjs'),
  gdscript: () => import('shiki/langs/gdscript.mjs'),
  nix: () => import('shiki/langs/nix.mjs'),
  scheme: () => import('shiki/langs/scheme.mjs'),
  lisp: () => import('shiki/langs/lisp.mjs'),
  'emacs-lisp': () => import('shiki/langs/emacs-lisp.mjs'),
  viml: () => import('shiki/langs/viml.mjs'),
  regexp: () => import('shiki/langs/regexp.mjs'),
}

/** Extension / alias → Shiki language id */
const LANG_ALIASES: Record<string, string> = {
  // JS / TS
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  cts: 'typescript',
  mts: 'typescript',

  // Python / systems
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  rb: 'ruby',
  erb: 'erb',
  php: 'php',
  swift: 'swift',
  dart: 'dart',
  scala: 'scala',
  sc: 'scala',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  pm: 'perl',
  jl: 'julia',
  hs: 'haskell',
  lhs: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  ml: 'ocaml',
  mli: 'ocaml',
  zig: 'zig',
  nim: 'nim',
  cr: 'crystal',
  v: 'v',
  sol: 'solidity',
  move: 'move',
  wat: 'wasm',
  wasm: 'wasm',
  s: 'asm',
  asm: 'asm',
  S: 'asm',

  // Shell / ops
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  shell: 'bash',
  shellscript: 'shellscript',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  fish: 'fish',
  dockerfile: 'docker',
  docker: 'docker',
  nginx: 'nginx',
  conf: 'ini',
  cfg: 'ini',
  ini: 'ini',
  env: 'dotenv',
  makefile: 'makefile',
  mk: 'makefile',
  cmake: 'cmake',
  gradle: 'groovy',
  groovy: 'groovy',

  // Data / config
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  svg: 'xml',
  properties: 'properties',
  props: 'xml',
  csv: 'csv',
  tsv: 'tsv',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  proto: 'protobuf',
  protobuf: 'protobuf',
  tf: 'terraform',
  tfvars: 'terraform',
  hcl: 'hcl',

  // Web markup
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',

  // Docs
  tex: 'latex',
  latex: 'latex',
  bib: 'bibtex',
  rst: 'rst',
  adoc: 'asciidoc',
  asciidoc: 'asciidoc',
  diff: 'diff',
  patch: 'diff',
  log: 'log',
  http: 'http',
  mermaid: 'mermaid',
  mmd: 'mermaid',

  // Templates
  hbs: 'handlebars',
  handlebars: 'handlebars',
  j2: 'jinja',
  jinja: 'jinja',
  jinja2: 'jinja',
  liquid: 'liquid',
  twig: 'twig',
  pug: 'pug',
  jade: 'pug',

  // Mobile / native
  m: 'objective-c',
  mm: 'objective-cpp',
  matlab: 'matlab',

  // Shaders / game
  glsl: 'glsl',
  frag: 'glsl',
  vert: 'glsl',
  hlsl: 'hlsl',
  wgsl: 'wgsl',
  gd: 'gdscript',

  // Misc
  nix: 'nix',
  scm: 'scheme',
  el: 'emacs-lisp',
  vim: 'viml',
  vimrc: 'viml',
  jsonc: 'jsonc',
  json5: 'json5',
  json: 'json',
}

/** Boot-time grammars (hot path). Everything else loads on first use. */
const CORE_LANG_IDS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'jsonc',
  'bash',
  'yaml',
  'markdown',
  'mdx',
  'css',
  'scss',
  'html',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'sql',
  'toml',
  'xml',
  'docker',
  'diff',
  'ini',
] as const

function guessLangFromPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() || path
  const lowerBase = base.toLowerCase()
  if (lowerBase === 'dockerfile' || lowerBase.startsWith('dockerfile.')) return 'docker'
  if (lowerBase === 'makefile' || lowerBase === 'gnumakefile') return 'makefile'
  if (lowerBase === 'cmakelists.txt') return 'cmake'
  if (lowerBase === '.env' || lowerBase.startsWith('.env.')) return 'dotenv'
  // .gitignore / .dockerignore: no dedicated grammar — plain text is fine
  if (lowerBase === '.gitignore' || lowerBase === '.dockerignore') return undefined

  const match = base.match(/\.([a-zA-Z0-9]+)$/)
  if (!match) return undefined
  const extension = match[1].toLowerCase()
  return LANG_ALIASES[extension] || extension
}

function resolveLangId(lang?: string): string {
  if (!lang) return 'text'
  const lower = lang.toLowerCase()
  return LANG_ALIASES[lower] || lower
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

async function loadLangModule(langId: string): Promise<LanguageRegistration | LanguageRegistration[] | null> {
  const loader = LANG_LOADERS[langId]
  if (!loader) return null
  const mod = await loader()
  return mod.default
}

/**
 * Explicit language/theme load via shiki/core — core set at boot, extras on demand.
 */
async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter
  if (!loadPromise) {
    loadPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/oniguruma'),
      ])
      const coreLoaders = CORE_LANG_IDS.map((id) => {
        const loader = LANG_LOADERS[id]
        if (!loader) throw new Error(`Missing LANG_LOADER for core lang: ${id}`)
        return loader()
      })
      const [githubLight, githubDark, wasm, ...coreLangModules] = await Promise.all([
        import('shiki/themes/github-light.mjs'),
        import('shiki/themes/github-dark.mjs'),
        import('shiki/wasm'),
        ...coreLoaders,
      ])
      const langs = coreLangModules.map((mod) => mod.default)
      const instance = await createHighlighterCore({
        themes: [githubLight.default, githubDark.default],
        langs,
        engine: createOnigurumaEngine(wasm),
      })
      highlighter = instance
      return instance
    })()
  }
  return loadPromise
}

/** Load grammar if needed; returns a language id the highlighter can use. */
async function ensureLanguage(instance: HighlighterCore, langId: string): Promise<string> {
  if (!langId || langId === 'text' || langId === 'plain') return 'text'
  const loaded = instance.getLoadedLanguages() as string[]
  if (loaded.includes(langId)) return langId

  try {
    const registration = await loadLangModule(langId)
    if (!registration) return 'text'
    await instance.loadLanguage(registration)
    const afterLoad = instance.getLoadedLanguages() as string[]
    return afterLoad.includes(langId) ? langId : 'text'
  } catch {
    return 'text'
  }
}

/**
 * Plain fallback must stay inside a pre/code block.
 * Bare escaped text injected via dangerouslySetInnerHTML collapses newlines
 * (HTML whitespace rules) into a single line in the file preview pane.
 */
export function wrapPlainCodeHtml(text: string): string {
  return `<pre class="shiki"><code>${escapeHtml(text)}</code></pre>`
}

/** Highlight code to HTML; falls back to escaped plain text on failure. */
export async function highlightCodeToHtml(code: string, lang?: string): Promise<string> {
  const trimmed = code.replace(/\n$/, '')
  if (!trimmed) return ''
  const requested = resolveLangId(lang)
  try {
    const instance = await getHighlighter()
    const useLanguage = await ensureLanguage(instance, requested)
    const theme = isDark() ? 'github-dark' : 'github-light'
    if (useLanguage === 'text') {
      return wrapPlainCodeHtml(trimmed)
    }
    return instance.codeToHtml(trimmed, {
      lang: useLanguage,
      theme: theme as 'github-dark' | 'github-light',
    })
  } catch {
    return wrapPlainCodeHtml(trimmed)
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Language ids that have an explicit loader (for tests / diagnostics). */
export function listSupportedHighlightLangIds(): string[] {
  return Object.keys(LANG_LOADERS).sort()
}

export { guessLangFromPath, resolveLangId }
