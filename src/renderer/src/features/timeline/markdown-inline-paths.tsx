import { memo, type ReactNode } from 'react'
import { openReviewGitForPath, openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'

const PATH_RE =
  /(?:^|[\s(])(@?)([\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|vue|py|go|rs|java|kt|swift|yml|yaml|toml|xml|sql|sh|ps1|txt|lock))(?:[):,;.\s]|$)/gi

function looksLikePath(segment: string): boolean {
  if (!segment || segment.length < 3) return false
  if (/^https?:\/\//i.test(segment)) return false
  if (segment.includes('@') && !segment.startsWith('@renderer') && !segment.startsWith('@shared')) return false
  return segment.includes('/') || /\.[a-z0-9]{1,6}$/i.test(segment)
}

export const MarkdownPathText = memo(function MarkdownPathText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  const re = new RegExp(PATH_RE.source, PATH_RE.flags)
  while ((m = re.exec(text)) !== null) {
    const prefix = m[0].charAt(0) === ' ' || m[0].charAt(0) === '(' ? m[0].charAt(0) : ''
    const at = m[1]
    const path = m[2]
    const start = m.index + (prefix ? 1 : 0)
    if (start > last) parts.push(text.slice(last, start))
    const full = `${at}${path}`
    if (looksLikePath(path)) {
      parts.push(
        <button
          key={`${start}-${path}`}
          type="button"
          className="mx-0.5 inline rounded px-0.5 font-mono text-[12px] text-primary hover:underline"
          onClick={(e) => {
            e.preventDefault()
            if (e.shiftKey) openReviewGitForPath(path)
            else openWorkspaceRelativePath(path)
          }}
          title="Files · Shift+Review"
        >
          {full}
        </button>,
      )
    } else {
      parts.push(full)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
})

export function enrichPlainTextWithPaths(text: string): ReactNode {
  const probe = new RegExp(PATH_RE.source, PATH_RE.flags)
  if (!probe.test(text)) return text
  return <MarkdownPathText text={text} />
}