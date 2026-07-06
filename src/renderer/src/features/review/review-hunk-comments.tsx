import { useCallback, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import {
  deleteReviewComment,
  listReviewComments,
  upsertReviewComment,
  type ReviewInlineComment,
} from './review-inline-comments'

export function ReviewHunkComments({
  cwd,
  filePath,
  hunkIndex,
}: {
  cwd: string
  filePath: string
  hunkIndex: number
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [tick, setTick] = useState(0)

  const comments = listReviewComments(cwd, filePath).filter((c) => c.hunkIndex === hunkIndex)
  void tick

  const bump = useCallback(() => setTick((t) => t + 1), [])

  const save = () => {
    const text = draft.trim()
    if (!text) return
    upsertReviewComment(cwd, { filePath, hunkIndex, lineIndex: 0, text })
    setDraft('')
    bump()
  }

  return (
    <div className="relative ml-1">
      <button
        type="button"
        className="chrome-icon-btn flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-muted-foreground/70 hover:text-foreground"
        title="行内评论草稿"
        onClick={() => setOpen((o) => !o)}
      >
        <MessageSquarePlus className="h-3 w-3" />
        {comments.length > 0 ? comments.length : null}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border/60 bg-[var(--bg-1)] p-2 shadow-md">
          {comments.map((c: ReviewInlineComment) => (
            <div key={c.id} className="mb-1.5 rounded bg-[var(--bg-2)] px-2 py-1 text-[10px] text-foreground-secondary">
              <div className="whitespace-pre-wrap break-words">{c.text}</div>
              <button
                type="button"
                className="mt-0.5 text-[9px] text-destructive/80 hover:underline"
                onClick={() => {
                  deleteReviewComment(cwd, c.id)
                  bump()
                }}
              >
                删除
              </button>
            </div>
          ))}
          <textarea
            className="w-full resize-none rounded border border-border/50 bg-background px-2 py-1 font-sans text-[10px]"
            rows={2}
            placeholder="评论草稿…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="mt-1 w-full rounded bg-primary/10 py-1 text-[10px] text-primary hover:bg-primary/15"
            onClick={save}
          >
            保存
          </button>
        </div>
      )}
    </div>
  )
}