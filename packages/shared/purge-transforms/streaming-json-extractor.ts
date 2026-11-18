export const PURGE_REPLY_TOOL_NAME = 'purge_reply'
export const PURGE_CONTEXT_TOOL_NAME = 'context'
export const PURGE_SENTINEL_WRITE_BASENAME = '__pi_purge_reply__.txt'

export function isSentinelRelayWritePath(rawPath: unknown): boolean {
  const p = String(rawPath ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!p) return false
  return p === PURGE_SENTINEL_WRITE_BASENAME || p.endsWith(`/${PURGE_SENTINEL_WRITE_BASENAME}`)
}

export interface StreamingFieldEmission {
  field: string
  delta: string
}

type ScanPhase =
  | 'expect_key_or_end'
  | 'in_key'
  | 'expect_colon'
  | 'expect_value'
  | 'in_string_value'
  | 'in_nested_structure'
  | 'in_primitive_value'

/**
 * Zero-dependency character-level streaming JSON object string-field extractor.
 * Decodes top-level string fields (such as `think_chain`, `content`, `path`) incrementally across
 * arbitrary SSE byte/character boundaries, including split escapes (`\"`, `\n`, `\uXXXX`, surrogate pairs),
 * and salvages partial content cleanly even when truncated by `maxTokens`.
 */
export class StreamingJsonObjectFieldExtractor {
  private readonly trackedFields: ReadonlySet<string>
  private startedObject = false
  private phase: ScanPhase = 'expect_key_or_end'
  private keyBuf = ''
  private keyEscape = false
  private currentKey = ''
  private valEscape = false
  private unicodeHex: string | null = null
  private pendingHighSurrogate: number | null = null
  private nestedDepth = 0
  private nestedInString = false
  private nestedEscape = false

  constructor(fields: readonly string[]) {
    this.trackedFields = new Set(fields)
  }

  feed(chunk: string): StreamingFieldEmission[] {
    const emissions: StreamingFieldEmission[] = []
    if (!chunk) return emissions

    const appendDelta = (field: string, text: string) => {
      if (!text) return
      const last = emissions[emissions.length - 1]
      if (last && last.field === field) {
        last.delta += text
      } else {
        emissions.push({ field, delta: text })
      }
    }

    const flushLoneSurrogate = (field: string) => {
      if (this.pendingHighSurrogate !== null) {
        appendDelta(field, String.fromCharCode(this.pendingHighSurrogate))
        this.pendingHighSurrogate = null
      }
    }

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]

      if (!this.startedObject) {
        if (ch === '{') {
          this.startedObject = true
          this.phase = 'expect_key_or_end'
        }
        continue
      }

      switch (this.phase) {
        case 'expect_key_or_end': {
          if (ch === '"') {
            this.keyBuf = ''
            this.keyEscape = false
            this.phase = 'in_key'
          }
          break
        }

        case 'in_key': {
          if (this.keyEscape) {
            this.keyBuf += ch
            this.keyEscape = false
          } else if (ch === '\\') {
            this.keyEscape = true
          } else if (ch === '"') {
            this.currentKey = this.keyBuf
            this.phase = 'expect_colon'
          } else {
            this.keyBuf += ch
          }
          break
        }

        case 'expect_colon': {
          if (ch === ':') {
            this.phase = 'expect_value'
          }
          break
        }

        case 'expect_value': {
          if (/\s/.test(ch)) break
          if (ch === '"') {
            this.valEscape = false
            this.unicodeHex = null
            this.pendingHighSurrogate = null
            this.phase = 'in_string_value'
          } else if (ch === '{' || ch === '[') {
            this.nestedDepth = 1
            this.nestedInString = false
            this.nestedEscape = false
            this.phase = 'in_nested_structure'
          } else {
            this.phase = 'in_primitive_value'
          }
          break
        }

        case 'in_string_value': {
          const tracked = this.trackedFields.has(this.currentKey)

          if (this.unicodeHex !== null) {
            if (/^[0-9a-fA-F]$/.test(ch)) {
              this.unicodeHex += ch
              if (this.unicodeHex.length === 4) {
                const code = parseInt(this.unicodeHex, 16)
                this.unicodeHex = null
                if (tracked) {
                  if (code >= 0xd800 && code <= 0xdbff) {
                    flushLoneSurrogate(this.currentKey)
                    this.pendingHighSurrogate = code
                  } else if (code >= 0xdc00 && code <= 0xdfff && this.pendingHighSurrogate !== null) {
                    const pair = String.fromCodePoint(
                      (this.pendingHighSurrogate - 0xd800) * 0x400 + (code - 0xdc00) + 0x10000,
                    )
                    this.pendingHighSurrogate = null
                    appendDelta(this.currentKey, pair)
                  } else {
                    flushLoneSurrogate(this.currentKey)
                    appendDelta(this.currentKey, String.fromCharCode(code))
                  }
                }
              }
              break
            } else {
              // Malformed unicode escape: emit literal fallback and re-process char
              if (tracked) {
                flushLoneSurrogate(this.currentKey)
                appendDelta(this.currentKey, `\\u${this.unicodeHex}`)
              }
              this.unicodeHex = null
            }
          }

          if (this.valEscape) {
            this.valEscape = false
            if (ch === 'u') {
              this.unicodeHex = ''
              break
            }
            if (tracked) {
              flushLoneSurrogate(this.currentKey)
              switch (ch) {
                case '"':
                  appendDelta(this.currentKey, '"')
                  break
                case '\\':
                  appendDelta(this.currentKey, '\\')
                  break
                case '/':
                  appendDelta(this.currentKey, '/')
                  break
                case 'n':
                  appendDelta(this.currentKey, '\n')
                  break
                case 'r':
                  appendDelta(this.currentKey, '\r')
                  break
                case 't':
                  appendDelta(this.currentKey, '\t')
                  break
                case 'b':
                  appendDelta(this.currentKey, '\b')
                  break
                case 'f':
                  appendDelta(this.currentKey, '\f')
                  break
                default:
                  appendDelta(this.currentKey, ch)
                  break
              }
            }
            break
          }

          if (ch === '\\') {
            this.valEscape = true
            break
          }

          if (ch === '"') {
            if (tracked) flushLoneSurrogate(this.currentKey)
            this.phase = 'expect_key_or_end'
            break
          }

          if (tracked) {
            flushLoneSurrogate(this.currentKey)
            appendDelta(this.currentKey, ch)
          }
          break
        }

        case 'in_nested_structure': {
          if (this.nestedInString) {
            if (this.nestedEscape) {
              this.nestedEscape = false
            } else if (ch === '\\') {
              this.nestedEscape = true
            } else if (ch === '"') {
              this.nestedInString = false
            }
          } else {
            if (ch === '"') {
              this.nestedInString = true
            } else if (ch === '{' || ch === '[') {
              this.nestedDepth++
            } else if (ch === '}' || ch === ']') {
              this.nestedDepth--
              if (this.nestedDepth <= 0) {
                this.phase = 'expect_key_or_end'
              }
            }
          }
          break
        }

        case 'in_primitive_value': {
          if (ch === ',' || ch === '}') {
            this.phase = 'expect_key_or_end'
          }
          break
        }
      }
    }

    return emissions
  }
}

/**
 * Parse completed or truncated tool arguments for `purge_reply` (salvage fallback).
 */
export function salvagePurgeReplyFields(rawArgs: unknown): {
  thinkChain: string
  content: string
} {
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const obj = rawArgs as Record<string, unknown>
    return {
      thinkChain: typeof obj.think_chain === 'string' ? obj.think_chain : '',
      content: typeof obj.content === 'string' ? obj.content : '',
    }
  }
  if (typeof rawArgs === 'string' && rawArgs) {
    const scanner = new StreamingJsonObjectFieldExtractor(['think_chain', 'content'])
    let thinkChain = ''
    let content = ''
    for (const part of scanner.feed(rawArgs)) {
      if (part.field === 'think_chain') thinkChain += part.delta
      else if (part.field === 'content') content += part.delta
    }
    return { thinkChain, content }
  }
  return { thinkChain: '', content: '' }
}
