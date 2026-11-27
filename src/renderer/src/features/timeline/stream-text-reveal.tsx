import { cn } from '@renderer/lib/utils'

/** Soft fade tip length — visual only, no source lag. */
export const STREAM_REVEAL_TIP_CHARS = 2

/**
 * @deprecated name kept for tests; display never lags the source stream.
 * Tip fade uses at most this many newest characters.
 */
export const STREAM_REVEAL_MAX_LAG_CHARS = STREAM_REVEAL_TIP_CHARS

/**
 * Render streaming plain text with a soft fade on the newest 1–2 characters.
 * Text is always the full source — no buffer delay behind real stream speed.
 */
export function StreamLiveTail({
  text,
  streaming,
  className,
}: {
  text: string
  streaming?: boolean
  className?: string
}) {
  if (!streaming || text.length === 0) {
    return <span className={className}>{text}</span>
  }

  const chars = Array.from(text)
  const tipLen = Math.min(STREAM_REVEAL_TIP_CHARS, chars.length)
  const body = chars.slice(0, chars.length - tipLen).join('')
  const tip = chars.slice(chars.length - tipLen).join('')

  return (
    <span className={className}>
      {body}
      {tip ? (
        <span className="stream-char-tip">
          {tip}
        </span>
      ) : null}
    </span>
  )
}

export function StreamLiveTailBlock({
  text,
  streaming,
  className,
}: {
  text: string
  streaming?: boolean
  className?: string
}) {
  return (
    <p className={cn('stream-live-tail my-1 whitespace-pre-wrap break-words leading-relaxed', className)}>
      <StreamLiveTail text={text} streaming={streaming} />
    </p>
  )
}
