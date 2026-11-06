const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i
// Drive or UNC paths, or POSIX paths with at least two segments (so "/fork" stays a command).
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/[^\s/]+\/)/

/**
 * A prompt as a one-line conversation title / summary. Attachments land in the prompt as absolute
 * paths (pasted images as app-internal clipboard files) and would crowd out what the user typed:
 * image paths are dropped, other paths shorten to their file name (keeping an `@` mention).
 */
export function sessionPreviewText(text: string): string {
  return String(text || '')
    .split(/\s+/)
    .flatMap((token) => {
      const mention = token.startsWith('@')
      const path = mention ? token.slice(1) : token
      if (!ABSOLUTE_PATH.test(path)) return token ? [token] : []
      if (IMAGE_FILE.test(path)) return []
      const name = path.split(/[\\/]/).filter(Boolean).pop() || path
      return [mention ? `@${name}` : name]
    })
    .join(' ')
}
