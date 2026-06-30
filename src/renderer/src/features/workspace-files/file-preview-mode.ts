export type FilePreviewMode =
  | 'image'
  | 'markdown'
  | 'html'
  | 'code'
  | 'text'
  | 'pdf'
  | 'binary'
  | 'sheet'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif'])
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'rb',
  'php', 'swift', 'kt', 'sh', 'json', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss', 'vue', 'svelte', 'sql', 'lua', 'dart', 'gradle',
])
const TEXT_EXT = new Set(['txt', 'log', 'env', 'ini', 'cfg', 'conf', 'gitignore', 'dockerignore'])
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v', 'wmv'])
const SHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'])

export function extOfPath(path: string): string {
  const base = path.split(/[\\/]/).pop() || path
  const i = base.lastIndexOf('.')
  if (i <= 0) return ''
  return base.slice(i + 1).toLowerCase()
}

/** 预览路由只看扩展名，避免 attachment kind 把 json/txt 误送进 Markdown。 */
export function resolveFilePreviewMode(relativePath: string): FilePreviewMode {
  const ext = extOfPath(relativePath)
  if (!ext) return 'text'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'pdf') return 'pdf'
  if (CODE_EXT.has(ext)) return 'code'
  if (TEXT_EXT.has(ext)) return 'text'
  if (SHEET_EXT.has(ext)) return 'sheet'
  if (ARCHIVE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) return 'binary'
  if (['doc', 'docx', 'rtf', 'odt', 'pages'].includes(ext)) return 'binary'
  return 'text'
}

export function fileKindLabel(name: string): string {
  const ext = extOfPath(name)
  if (!ext) return 'file'
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    json: 'JSON',
    md: 'Markdown',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    html: 'HTML',
    css: 'CSS',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    sh: 'Shell',
    txt: 'Text',
    log: 'Log',
    pdf: 'PDF',
    png: 'Image',
    jpg: 'Image',
    jpeg: 'Image',
    svg: 'SVG',
    zip: 'Archive',
  }
  return map[ext] || ext
}