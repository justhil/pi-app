type TextSegment = { type: 'text'; text: string }
type FileSegment = {
  type: 'file'
  attachment: {
    path: string
    kind?: string
    line?: number
    endLine?: number
    name?: string
  }
}
type ClipboardImageSegment = { type: 'clipboard-image'; path: string; name: string }
type Segment = TextSegment | FileSegment | ClipboardImageSegment

export const CLIPBOARD_IMAGE_PAYLOAD = '[image file]'

function isClipboardTempPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() || ''
  return base.startsWith('pi-clipboard-')
}

export function segmentsToPromptPayload(segments: Segment[]): string {
  let out = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.type === 'text') {
      out += seg.text
      continue
    }
    if (out && !/\s$/.test(out)) out += ' '
    if (seg.type === 'file') {
      const att = seg.attachment
      if (att.kind === 'line-ref' && att.line != null) {
        const linePart =
          att.endLine != null && att.endLine !== att.line
            ? `${att.line}-${att.endLine}`
            : String(att.line)
        out += `@${att.path}:${linePart}`
      } else {
        out += isClipboardTempPath(att.path) ? att.path : `@${att.path}`
      }
    } else {
      out += seg.path
    }
    const next = segments[i + 1]
    if (next?.type === 'text' && next.text && !/^\s/.test(next.text)) out += ' '
  }
  return out.trim()
}
