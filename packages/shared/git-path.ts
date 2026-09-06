const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\\': '\\' }

/** Git core.quotePath encodes UTF-8 bytes as C-style octal escapes. */
export function unquoteGitPath(value: string): string {
  const raw = value.trim()
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw
  return raw.slice(1, -1).replace(/(?:\\[0-7]{1,3})+|\\([abfnrtv"\\])/g, (sequence, escaped: string | undefined) => {
    if (escaped) return escapes[escaped]
    const bytes = sequence.slice(1).split('\\').map(byte => parseInt(byte, 8))
    return new TextDecoder().decode(Uint8Array.from(bytes))
  })
}
