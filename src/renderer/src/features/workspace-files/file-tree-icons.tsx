import {
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  Music,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { extOfPath } from './file-preview-mode'

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'rb',
  'php', 'swift', 'kt', 'sh', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss', 'vue', 'svelte', 'sql', 'lua', 'dart', 'gradle',
])

export function fileTreeIcon(name: string, isDirectory: boolean): { Icon: LucideIcon; className: string } {
  if (isDirectory) {
    return { Icon: Folder, className: 'text-amber-600/90 dark:text-amber-500/90' }
  }
  const ext = extOfPath(name)
  if (ext === 'json') return { Icon: FileJson, className: 'text-blue-600/90 dark:text-blue-400/90' }
  if (ext === 'md' || ext === 'markdown') return { Icon: FileType, className: 'text-violet-600/90 dark:text-violet-400/90' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'].includes(ext)) {
    return { Icon: FileImage, className: 'text-emerald-600/90 dark:text-emerald-400/90' }
  }
  if (ext === 'pdf') return { Icon: FileText, className: 'text-rose-600/90 dark:text-rose-400/90' }
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext)) {
    return { Icon: FileSpreadsheet, className: 'text-green-600/90 dark:text-green-400/90' }
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { Icon: FileArchive, className: 'text-amber-700/90 dark:text-amber-500/90' }
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return { Icon: Music, className: 'text-purple-600/90 dark:text-purple-400/90' }
  }
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return { Icon: Video, className: 'text-pink-600/90 dark:text-pink-400/90' }
  }
  if (CODE_EXT.has(ext) || ext === 'html' || ext === 'htm') {
    return { Icon: FileCode2, className: 'text-blue-600/90 dark:text-blue-400/90' }
  }
  if (['txt', 'log', 'env'].includes(ext)) {
    return { Icon: FileText, className: 'text-foreground-secondary/80' }
  }
  return { Icon: File, className: 'text-foreground-secondary/75' }
}