import type { AttachmentMeta, Segment } from '@renderer/features/composer/attachments'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
/** An absolute path as `segmentsToPromptPayload` writes it: `@C:/x/y.png` or `@"C:/x y/z.png"`. */
const ABS_PATH = /@?"[A-Za-z]:[\\/][^"\n\r]+"|@?[A-Za-z]:[\\/][^\s"'<>|]+/g

/**
 * A prompt sent with a picture carries the picture's path as text (that is what the agent reads).
 * Reopening, rewinding or the live timeline echo therefore shows a path where the picture was.
 * The path is enough to render it again: `clipboard.readTempImage` answers with the stored bytes.
 */
export function splitImagePathSegments(segments: Segment[]): Segment[] {
  if (segments.some((s) => s.type === 'clipboard-image' || (s.type === 'file' && s.attachment.kind === 'image'))) {
    return segments
  }
  const out: Segment[] = []
  for (const segment of segments) {
    if (segment.type !== 'text') {
      out.push(segment)
      continue
    }
    let rest = segment.text
    for (const raw of segment.text.match(ABS_PATH) ?? []) {
      const path = raw.replace(/^@/, '').replace(/^"|"$/g, '').trim()
      if (!IMAGE_EXT.test(path)) continue
      const at = rest.indexOf(raw)
      if (at === -1) continue
      const before = rest.slice(0, at).trim()
      if (before) out.push({ type: 'text', text: before })
      const name = path.replace(/\\/g, '/').split('/').pop() || path
      const attachment: AttachmentMeta = { path, name, kind: 'image' }
      out.push({ type: 'file', attachment })
      rest = rest.slice(at + raw.length)
    }
    if (rest.trim()) out.push({ type: 'text', text: rest.trim() })
  }
  return out
}
