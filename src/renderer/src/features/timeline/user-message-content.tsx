import { Fragment, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import type { AttachmentMeta, Segment } from '@renderer/features/composer/attachments'
import { ClipboardImageChip } from './clipboard-image-chip'
import { enrichPlainTextWithPaths } from './markdown-inline-paths'
import { anchorViewportBeforeCollapse } from './collapse-scroll-anchor'

export const USER_MESSAGE_FOLD_LINES = 8
export const USER_MESSAGE_FOLD_CHARS = 520

const FENCE_RE = /```([\w-]*)\r?\n([\s\S]*?)```/g
const INLINE_CODE_RE = /`([^`\r\n]+)`/g

function renderInlineCodeAndPaths(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let idx = 0
  for (const match of text.matchAll(INLINE_CODE_RE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      nodes.push(
        <Fragment key={`${keyPrefix}-t-${idx++}`}>
          {enrichPlainTextWithPaths(text.slice(cursor, start))}
        </Fragment>,
      )
    }
    nodes.push(
      <code key={`${keyPrefix}-c-${idx++}`} className="timeline-user-inline-code">
        {match[1]}
      </code>,
    )
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-t-${idx++}`}>
        {enrichPlainTextWithPaths(text.slice(cursor))}
      </Fragment>,
    )
  }
  return nodes.length > 0 ? nodes : [enrichPlainTextWithPaths(text)]
}

export function renderFormattedUserText(text: string, keyPrefix = 'u'): ReactNode {
  if (!text.includes('`')) {
    return enrichPlainTextWithPaths(text)
  }
  const parts: ReactNode[] = []
  let cursor = 0
  let idx = 0
  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      parts.push(...renderInlineCodeAndPaths(text.slice(cursor, start), `${keyPrefix}-p${idx++}`))
    }
    const codeBody = (match[2] ?? '').replace(/\r?\n$/, '')
    parts.push(
      <pre key={`${keyPrefix}-f${idx++}`} className="timeline-user-code-fence">
        <code>{codeBody}</code>
      </pre>,
    )
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    parts.push(...renderInlineCodeAndPaths(text.slice(cursor), `${keyPrefix}-p${idx++}`))
  }
  return parts
}

export function UserMessageBubble({
  segments,
  rawText,
}: {
  segments: Segment[]
  rawText: string
}) {
  const { t } = useTranslation()
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const lineCount = rawText ? rawText.split(/\r?\n/).length : 1
  const shouldFold = lineCount > USER_MESSAGE_FOLD_LINES || rawText.length > USER_MESSAGE_FOLD_CHARS
  const isCollapsed = shouldFold && !expanded

  const handleToggle = () => {
    if (expanded) {
      anchorViewportBeforeCollapse(bubbleRef.current)
      setExpanded(false)
    } else {
      setExpanded(true)
    }
  }

  return (
    <div ref={bubbleRef} data-pi-slot="timeline-user-bubble" className="timeline-user-bubble">
      <div className={cn('relative', isCollapsed && 'max-h-[10.5rem] overflow-hidden')}>
        {segments.map((s: Segment, i: number) => {
          if (s.type === 'text') {
            return <span key={i}>{renderFormattedUserText(s.text, `seg-${i}`)}</span>
          }
          if (s.type === 'clipboard-image') {
            return <ClipboardImageChip key={i} path={s.path} name={s.name} className="mx-0.5" />
          }
          const attachment = s.attachment as AttachmentMeta
          if (attachment.kind === 'image') {
            return (
              <ClipboardImageChip
                key={i}
                path={attachment.path}
                name={attachment.name}
                className="mx-0.5"
              />
            )
          }
          return <AttachmentChip key={i} attachment={attachment} openable className="mx-0.5" />
        })}
        {isCollapsed && (
          <div
            aria-hidden
            className="timeline-user-collapse-fade pointer-events-none absolute inset-x-0 bottom-0 h-10"
          />
        )}
      </div>
      {shouldFold && (
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11.5px] font-medium text-foreground-secondary/80 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          <span>{expanded ? t('timeline:collapse') : t('timeline:expand', { count: lineCount })}</span>
        </button>
      )}
    </div>
  )
}
