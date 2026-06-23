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

export interface AttachmentMeta {
  path: string
  name: string
  kind: AttachmentKind
}

export interface TextSegment { type: 'text'; text: string }
export interface FileSegment { type: 'file'; attachment: AttachmentMeta }
export type Segment = TextSegment | FileSegment

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
    default: return File
  }
}


/** Resolve a real on-disk path for a File from paste/drop, cross-platform. */
export function resolveFilePath(file: File): string | undefined {
  const p = window.piDesktop?.getPathForFile(file)
  if (p) return p
  return (file as any).path as string | undefined
}

export function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const ICON_SVGS: Record<AttachmentKind, string> = {} as any
function buildIconSvgs() {
  const icons: Record<AttachmentKind, LucideIcon> = {
    image: ImageIcon, pdf: FileText, doc: FileText, sheet: FileSpreadsheet,
    archive: FileArchive, code: FileCode2, audio: Music, video: Video, file: File,
  }
  for (const k of Object.keys(icons) as AttachmentKind[]) {
    ICON_SVGS[k] = renderToStaticMarkup(createElement(icons[k], { size: 11, strokeWidth: 2 }))
  }
}
buildIconSvgs()

/** 为富文本编辑器构建一个不可编辑的内联 chip DOM 节点。 */
export function createAttachmentChip(meta: AttachmentMeta): HTMLSpanElement {
  const span = document.createElement('span')
  span.setAttribute('contenteditable', 'false')
  span.dataset.attachmentPath = meta.path
  span.dataset.attachmentName = meta.name
  span.dataset.attachmentKind = meta.kind
  span.className = 'rich-attachment-chip'
  wireDelayedTooltip(span, meta.path)
  span.innerHTML = '<span class="rich-attachment-icon">' + ICON_SVGS[meta.kind] + '</span>'
    + '<span class="rich-attachment-name">' + escapeHtml(meta.name) + '</span>'
    + '<button type="button" class="rich-attachment-remove" aria-label="\u79fb\u9664\u6587\u4ef6"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>'
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
          const meta: AttachmentMeta = {
            path: e.dataset.attachmentPath,
            name: e.dataset.attachmentName || '',
            kind: (e.dataset.attachmentKind as AttachmentKind) || 'file',
          }
          segments.push({ type: 'file', attachment: meta })
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
    } else {
      frag.appendChild(document.createTextNode('\u200B'))
      frag.appendChild(createAttachmentChip(seg.attachment))
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

