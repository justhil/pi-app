import {
  Image as ImageIcon,
  FileText,
  FileCode2,
  FileArchive,
  FileSpreadsheet,
  File,
  Music,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { createElement } from 'react'
import { wireDelayedTooltip } from './delayed-tooltip'
import { renderToStaticMarkup } from 'react-dom/server'
import { segmentsToPromptPayload } from './attachment-text'

export type AttachmentKind =
  | 'image'
  | 'code'
  | 'archive'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'audio'
  | 'video'
  | 'file'
  /** Code line reference (Cursor-style path:line chip) */
  | 'line-ref'

export interface AttachmentMeta {
  path: string
  name: string
  kind: AttachmentKind
  /** For line-ref chips */
  line?: number
  endLine?: number
  snippet?: string
  /**
   * Stable DOM / React identity for chips. Same path may appear multiple times
   * (file + line-refs, or duplicate attaches) — never use path alone as a React key.
   */
  chipId?: string
}

/** Unique key for React lists and remove-by-identity. */
export function attachmentChipKey(meta: AttachmentMeta, index = 0): string {
  if (meta.chipId) return meta.chipId
  if (meta.kind === 'line-ref') {
    return `line-ref:${meta.path}:${meta.line ?? 0}:${meta.endLine ?? ''}:${meta.name}:${index}`
  }
  return `file:${meta.path}:${meta.kind}:${index}`
}

export function newAttachmentChipId(): string {
  return `chip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export interface TextSegment { type: 'text'; text: string }
export interface FileSegment { type: 'file'; attachment: AttachmentMeta }
export interface ClipboardImageSegment { type: 'clipboard-image'; path: string; name: string }
export type Segment = TextSegment | FileSegment | ClipboardImageSegment

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cc', 'h',
  'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'sh', 'json', 'yaml', 'yml', 'toml', 'xml',
  'html', 'css', 'scss', 'vue', 'svelte', 'sql', 'lua', 'dart', 'gradle',
])

export function getAttachmentKind(name: string): AttachmentKind {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'rtf', 'odt', 'pages', 'md', 'txt', 'log'].includes(ext)) return 'doc'
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'].includes(ext)) return 'sheet'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst'].includes(ext)) return 'archive'
  if (CODE_EXTS.has(ext)) return 'code'
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v', 'wmv'].includes(ext)) return 'video'
  return 'file'
}

export function getAttachmentIcon(kind: AttachmentKind): LucideIcon {
  switch (kind) {
    case 'image': return ImageIcon
    case 'pdf': return FileText
    case 'doc': return FileText
    case 'sheet': return FileSpreadsheet
    case 'archive': return FileArchive
    case 'code': return FileCode2
    case 'audio': return Music
    case 'video': return Video
    case 'line-ref': return FileCode2
    default: return File
  }
}


/** Resolve a real on-disk path for a File from paste/drop, cross-platform. */
export function resolveFilePath(file: File): string | undefined {
  try {
    const p = window.piDesktop?.getPathForFile(file)
    if (p) return p
  } catch {
    /* clipboard screenshots have no on-disk path */
  }
  return (file as File & { path?: string }).path
}

export function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const ICON_SVGS = {} as Record<AttachmentKind, string>
function buildIconSvgs() {
  const icons: Record<AttachmentKind, LucideIcon> = {
    image: ImageIcon, pdf: FileText, doc: FileText, sheet: FileSpreadsheet,
    archive: FileArchive, code: FileCode2, audio: Music, video: Video, file: File,
    'line-ref': FileCode2,
  }
  for (const k of Object.keys(icons) as AttachmentKind[]) {
    ICON_SVGS[k] = renderToStaticMarkup(createElement(icons[k], { size: 11, strokeWidth: 2 }))
  }
}
buildIconSvgs()

/** 为富文本编辑器构建一个不可编辑的内联 chip DOM 节点。 */
export function createAttachmentChip(meta: AttachmentMeta): HTMLSpanElement {
  const chipId = meta.chipId || newAttachmentChipId()
  const span = document.createElement('span')
  span.setAttribute('contenteditable', 'false')
  span.dataset.attachmentChipId = chipId
  span.dataset.attachmentPath = meta.path
  span.dataset.attachmentName = meta.name
  span.dataset.attachmentKind = meta.kind
  if (meta.line != null) span.dataset.attachmentLine = String(meta.line)
  if (meta.endLine != null) span.dataset.attachmentEndLine = String(meta.endLine)
  if (meta.snippet) span.dataset.attachmentSnippet = meta.snippet
  span.className =
    meta.kind === 'line-ref' ? 'rich-attachment-chip rich-attachment-chip--line-ref' : 'rich-attachment-chip'
  const tooltip =
    meta.kind === 'line-ref'
      ? `${meta.path}:${meta.line ?? ''}${meta.snippet ? `\n${meta.snippet}` : ''}`
      : meta.path
  wireDelayedTooltip(span, tooltip)
  const displayName = escapeHtml(meta.name)
  span.innerHTML =
    '<span class="rich-attachment-icon">' +
    (ICON_SVGS[meta.kind] || ICON_SVGS.file) +
    '</span>' +
    '<span class="rich-attachment-name">' +
    displayName +
    '</span>' +
    '<button type="button" class="rich-attachment-remove" aria-label="\u79fb\u9664"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>'
  return span
}


/** 将纯文本（含 \n）写进富文本编辑器。 */
export function renderRichTextFromPlain(el: HTMLElement, text: string) {
  el.innerHTML = ''
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode(line))
  })
  el.normalize()
}

/** 在光标处插入一个附件 chip（前后附加 ZWSP 让光标可停留）。 */
export function insertAttachmentAtCursor(el: HTMLElement, meta: AttachmentMeta) {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0)
    range.deleteContents()
  } else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  const before = document.createTextNode('\u200B')
  const chip = createAttachmentChip(meta)
  const after = document.createTextNode('\u200B')
  const frag = document.createDocumentFragment()
  frag.appendChild(before)
  frag.appendChild(chip)
  frag.appendChild(after)
  range.insertNode(frag)
  el.normalize()
  range.setStartAfter(after)
  range.setEndAfter(after)
  sel?.removeAllRanges()
  sel?.addRange(range)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 序列化富文本编辑器为文本段，chip 处为文件段。 */
export function serializeRichInput(el: HTMLElement): {
  segments: Segment[]
  displayText: string
  payload: string
  attachments: AttachmentMeta[]
} {
  const segments: Segment[] = []
  const attachments: AttachmentMeta[] = []
  let textBuf = ''
  const flush = () => {
    const cleaned = textBuf.replace(/\u200B/g, '')
    if (cleaned) segments.push({ type: 'text', text: cleaned })
    textBuf = ''
  }
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        textBuf += child.nodeValue || ''
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const e = child as HTMLElement
        if (e.dataset.attachmentPath) {
          flush()
          const kind = (e.dataset.attachmentKind as AttachmentKind) || 'file'
          const lineRaw = e.dataset.attachmentLine
          const endLineRaw = e.dataset.attachmentEndLine
          const meta: AttachmentMeta = {
            path: e.dataset.attachmentPath,
            name: e.dataset.attachmentName || '',
            kind,
            chipId: e.dataset.attachmentChipId,
            ...(lineRaw ? { line: Number(lineRaw) } : {}),
            ...(endLineRaw ? { endLine: Number(endLineRaw) } : {}),
            ...(e.dataset.attachmentSnippet ? { snippet: e.dataset.attachmentSnippet } : {}),
          }
          segments.push({ type: 'file', attachment: meta })
          // Include line-ref so composer treats chips as content (send button / empty check).
          // They are not on-disk uploads; prompt payload uses @path:line via segments.
          attachments.push(meta)
        } else if (e.tagName === 'BR') {
          textBuf += '\n'
        } else {
          walk(e)
        }
      }
    })
  }
  walk(el)
  flush()
  const displayText = segments.map((s) => {
    if (s.type === 'text') return s.text
    return ''
  }).join('').replace(/\u200B/g, '')
  const payload = segmentsToPromptPayload(segments)
  return { segments, displayText, payload, attachments }
}

/** 把光标置于编辑器末尾。 */
export function placeCaretAtEnd(el: HTMLElement) {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** 用文本分段重建富文本编辑器 DOM（保留附件 chip 位置）。 */
export function renderRichFromSegments(el: HTMLElement, segments: Segment[]) {
  el.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const seg of segments) {
    if (seg.type === 'text') {
      const lines = seg.text.split('\n')
      lines.forEach((line, i) => {
        if (i > 0) frag.appendChild(document.createElement('br'))
        frag.appendChild(document.createTextNode(line))
      })
    } else if (seg.type === 'file') {
      frag.appendChild(document.createTextNode('\u200B'))
      frag.appendChild(createAttachmentChip(seg.attachment))
      frag.appendChild(document.createTextNode('\u200B'))
    } else {
      const meta: AttachmentMeta = { path: seg.path, name: seg.name, kind: 'image' }
      frag.appendChild(document.createTextNode('\u200B'))
      frag.appendChild(createAttachmentChip(meta))
      frag.appendChild(document.createTextNode('\u200B'))
    }
  }
  el.appendChild(frag)
  el.normalize()
}

/** 替换最后一段文本的尾随 slash/参数 token；未命中返回原 segments。 */
export function replaceTrailingTokenInSegments(segments: Segment[], replacement: string): Segment[] {
  const out = [...segments]
  for (let i = out.length - 1; i >= 0; i--) {
    const seg = out[i]
    if (seg.type === 'text') {
      const replaced = seg.text.replace(/(?:^|\n)\/(\S*)$/, (_m, _p1, offset) => {
        const prefix = offset > 0 ? '\n' : ''
        return `${prefix}${replacement}`
      })
      if (replaced !== seg.text) {
        out[i] = { type: 'text', text: replaced }
        return out
      }
      const replaced2 = seg.text.replace(/(?:^|\n)(\/\S+\s+)\S*$/, (_m, p1) => `${p1}${replacement}`)
      if (replaced2 !== seg.text) {
        out[i] = { type: 'text', text: replaced2 }
        return out
      }
    }
  }
  return out
}

/** 删除尾随 slash token（Esc 关闭补全用）。 */
export function stripTrailingSlashToken(segments: Segment[]): Segment[] {
  const out = [...segments]
  for (let i = out.length - 1; i >= 0; i--) {
    const seg = out[i]
    if (seg.type === 'text') {
      const stripped = seg.text.replace(/(?:^|\n)\/(\S*)$/, '')
      if (stripped !== seg.text) {
        out[i] = { type: 'text', text: stripped }
        return out
      }
    }
  }
  return out
}

