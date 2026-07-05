export type ClipboardDataUrlImage = { mimeType: string; base64: string }

/** Some apps (screenshot tools, chat) paste only text/html with a large <img src="data:...">. */
export function extractDataUrlImageFromHtml(html: string): ClipboardDataUrlImage | null {
  if (!html.trim()) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const img = doc.querySelector('img')
  const src = img?.getAttribute('src')?.trim()
  if (!src?.startsWith('data:image/')) return null
  const sep = src.indexOf(';base64,')
  if (sep < 0) return null
  const mimeMatch = /^data:(image\/[a-z0-9.+-]+)/i.exec(src.slice(0, sep))
  if (!mimeMatch) return null
  const mimeType = mimeMatch[1].toLowerCase()
  const base64 = src.slice(sep + 8).replace(/\s/g, '')
  if (!base64) return null
  return { mimeType, base64 }
}

const CLIPBOARD_PASTE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
])

export function normalizeClipboardImageMime(raw: string): string | null {
  const base = (raw || '').split(';')[0].trim().toLowerCase()
  if (base === 'image/jpg') return 'image/jpeg'
  if (CLIPBOARD_PASTE_MIMES.has(base)) return base
  return null
}

export function isMeaningfulPlainPaste(plain: string): boolean {
  return plain.replace(/[\u200B\u00a0\s]/g, '').length > 0
}

/** Prefer clipboard FileList when DataTransferItem.getAsFile() is empty (common on macOS). */
export function firstClipboardImageFile(cd: DataTransfer): File | null {
  const items = cd.items
  if (items) {
    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const f = item.getAsFile()
      if (f) return f
    }
  }
  const files = cd.files
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f?.type?.startsWith('image/')) return f
    }
  }
  return null
}

export function plainTextFromClipboardHtml(html: string): string {
  if (!html.trim()) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ')
}