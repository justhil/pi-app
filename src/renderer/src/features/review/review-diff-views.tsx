import { useState, useCallback, useEffect, useRef, type RefObject } from 'react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { DiffFile, DiffHunk, DiffLine } from '@shared/diff-model'
import { buildSplitDiffRows } from '@shared/diff-split'
import { ReviewHunkComments } from './review-hunk-comments'
import { LineGutterAddButton } from '@renderer/components/ui/line-gutter-add'
import {
  FilePlus,
  FileEdit,
  FileMinus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  CheckCheck,
  GitCommitHorizontal,
} from '@renderer/components/icons'

export type DiffMode = 'inline' | 'split'

export function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-[var(--diff-added)]" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-[var(--diff-removed)]" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

function lineColor(type: DiffLine['type']): string {
  if (type === 'added') return 'diff-line-added'
  if (type === 'removed') return 'diff-line-removed'
  if (type === 'hunk-header') return 'text-foreground-secondary/60'
  return 'text-foreground-secondary'
}

function linePrefix(type: DiffLine['type']): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  if (type === 'hunk-header') return '@'
  return ' '
}

function DiffCodeLine({
  lineNo,
  gutter,
  prefix,
  text,
  className,
  filePath,
  canRef,
}: {
  lineNo?: number
  gutter: string
  prefix: string
  text: string
  className?: string
  filePath: string
  canRef: boolean
}) {
  return (
    <div className={cn('group/line flex min-w-0 items-start px-1', className)}>
      <span className="flex w-10 shrink-0 select-none items-start justify-end gap-0.5 pt-px pr-1 text-foreground-secondary/40">
        {canRef && lineNo != null ? (
          <LineGutterAddButton path={filePath} line={lineNo} content={text} className="mr-0.5" />
        ) : (
          <span className="w-[1.15em]" />
        )}
        <span className="w-6 text-right tabular-nums">{gutter}</span>
      </span>
      <span className="w-3 shrink-0 select-none text-foreground-secondary/40">{prefix}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{text}</span>
    </div>
  )
}

function DiffHunkView({
  hunk,
  hunkIndex,
  mode,
  staged,
  onToggleStage,
  filePath,
  cwd,
}: {
  hunk: DiffHunk
  hunkIndex: number
  mode: DiffMode
  staged: boolean
  onToggleStage: () => void
  filePath: string
  cwd: string
}) {
  return (
    <div className="border-b border-border/20 last:border-0">
      <div className="flex items-center gap-1.5 bg-[var(--bg-1)] px-2 py-1">
        <button
          type="button"
          onClick={onToggleStage}
          className={cn(
            'chrome-icon-btn rounded p-0.5 transition-colors',
            staged ? 'text-[var(--diff-added)]' : 'text-muted-foreground/50 hover:text-foreground',
          )}
          title={staged ? '撤销暂存此 hunk' : '暂存此 hunk'}
        >
          <CheckCheck className="h-3 w-3" />
        </button>
        <span className="font-mono text-[10px] text-foreground-secondary/60">
          @@ -{hunk.oldStart},{hunk.oldEnd - hunk.oldStart + 1} +{hunk.newStart},{hunk.newEnd - hunk.newStart + 1} @@
        </span>
        <ReviewHunkComments cwd={cwd} filePath={filePath} hunkIndex={hunkIndex} />
        <button
          type="button"
          onClick={() => void ipcClient.invoke('shell.openPath', { path: `${cwd}/${filePath}` })}
          className="ml-auto opacity-0 hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在编辑器打开"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {mode === 'inline' ? (
        <div className="min-w-0 font-mono text-[10px] leading-[1.5]">
          {hunk.lines.map((l, i) => {
            const lineNo =
              l.type === 'removed'
                ? l.oldLineNumber
                : l.type === 'added' || l.type === 'context'
                  ? l.newLineNumber ?? l.oldLineNumber
                  : undefined
            const prefix = linePrefix(l.type)
            return (
              <DiffCodeLine
                key={i}
                lineNo={lineNo}
                gutter={lineNo != null ? String(lineNo) : prefix}
                prefix={prefix}
                text={l.content}
                className={lineColor(l.type)}
                filePath={filePath}
                canRef={!!lineNo && l.type !== 'hunk-header'}
              />
            )
          })}
        </div>
      ) : (
        <SplitHunk hunk={hunk} filePath={filePath} />
      )}
    </div>
  )
}

function SplitHunk({ hunk, filePath }: { hunk: DiffHunk; filePath: string }) {
  const pseudoFile: DiffFile = {
    path: filePath,
    status: 'modified',
    changeType: 'modified',
    additions: 0,
    deletions: 0,
    hunks: [hunk],
    binary: false,
    large: false,
    generated: false,
  }
  const rows = buildSplitDiffRows(pseudoFile).slice(1)
  return (
    <div className="grid min-w-0 grid-cols-2 font-mono text-[10px] leading-[1.5]">
      {rows.map((row, i) => {
        const leftNo = row.left.oldLine ?? row.left.newLine
        const rightNo = row.right.newLine ?? row.right.oldLine
        return (
          <div key={i} className="contents">
            <DiffCodeLine
              lineNo={leftNo}
              gutter={leftNo != null ? String(leftNo) : ''}
              prefix={row.left.kind === 'remove' ? '-' : ' '}
              text={row.left.text}
              className={cn(
                'min-w-0 border-r border-border/30',
                row.left.kind === 'remove' && 'diff-line-removed',
                row.left.kind === 'context' && 'text-foreground-secondary',
              )}
              filePath={filePath}
              canRef={!!leftNo && row.left.kind !== 'empty'}
            />
            <DiffCodeLine
              lineNo={rightNo}
              gutter={rightNo != null ? String(rightNo) : ''}
              prefix={row.right.kind === 'add' ? '+' : ' '}
              text={row.right.text}
              className={cn(
                'min-w-0',
                row.right.kind === 'add' && 'diff-line-added',
                row.right.kind === 'context' && 'text-foreground-secondary',
              )}
              filePath={filePath}
              canRef={!!rightNo && row.right.kind !== 'empty'}
            />
          </div>
        )
      })}
    </div>
  )
}

export function FileDiffView({
  file,
  fallbackPath,
  fallbackChangeType,
  group,
  mode,
  cwd,
  defaultOpen,
  onMutated,
  focusToken,
  focusScrollRef,
}: {
  file: DiffFile | undefined
  fallbackPath: string
  fallbackChangeType: string
  group: 'staged' | 'unstaged'
  mode: DiffMode
  cwd: string
  defaultOpen: boolean
  onMutated: () => void
  /** 焦点请求令牌：变化时若本文件是焦点目标则重新展开（面板已挂载时也能生效） */
  focusToken?: number
  /** 面板滚动容器：焦点跳转时把目标滚动到中上位置 */
  focusScrollRef?: RefObject<HTMLDivElement | null>
}) {
  const [open, setOpen] = useState(defaultOpen)
  const lastFocusToken = useRef(focusToken)
  const headerRef = useRef<HTMLDivElement>(null)
  const filePath = file?.path ?? fallbackPath
  const staged = group === 'staged'
  /** 新增（未跟踪）文件不在 git diff 输出里：展开时读取全文按全量新增展示 */
  const [addedContent, setAddedContent] = useState<string | null>(null)
  const [addedLoading, setAddedLoading] = useState(false)
  const [addedUnavailable, setAddedUnavailable] = useState(false)

  /** 焦点目标在滚动容器中的落点：距顶部 25%（中上位置）。返回目标 scrollTop，用于后续漂移校正 */
  const scrollFocusedIntoPlace = (smooth: boolean): number | null => {
    const el = headerRef.current
    const container = focusScrollRef?.current
    if (!el || !container || typeof container.scrollTo !== 'function') return null
    const relative =
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    const top = Math.max(0, relative - container.clientHeight * 0.25)
    container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
    return top
  }

  const defaultOpenRef = useRef(defaultOpen)
  defaultOpenRef.current = defaultOpen
  /** 偶发布局漂移校正：若落点偏离期望位置超过阈值且无人为干预，重新定位（最多 attempts 次） */
  const verifyFocusScroll = (expectedTop: number, attempts: number) => {
    if (attempts <= 0 || !defaultOpenRef.current) return
    const el = headerRef.current
    const container = focusScrollRef?.current
    if (!el || !container) return
    // 平滑动画未完或用户已滚动容器：不干预
    if (Math.abs(container.scrollTop - expectedTop) > 16) return
    const actual = el.getBoundingClientRect().top - container.getBoundingClientRect().top
    const want = container.clientHeight * 0.25
    if (Math.abs(actual - want) > 56) {
      container.scrollTo({ top: expectedTop, behavior: 'auto' })
      window.setTimeout(() => verifyFocusScroll(expectedTop, attempts - 1), 150)
    }
  }

  /** 焦点滚动 + 漂移校正回查。smooth=false（挂载首帧）时瞬时定位，避免与布局稳定竞态 */
  const focusScrollIntoPlace = (smooth: boolean) => {
    const top = scrollFocusedIntoPlace(smooth)
    if (top == null) return
    window.setTimeout(() => verifyFocusScroll(top, 3), smooth ? 250 : 60)
    window.setTimeout(() => verifyFocusScroll(top, 2), smooth ? 550 : 200)
    window.setTimeout(() => verifyFocusScroll(top, 1), smooth ? 900 : 450)
  }

  useEffect(() => {
    if (focusToken == null || focusToken === lastFocusToken.current) return
    lastFocusToken.current = focusToken
    if (defaultOpen) {
      setOpen(true)
      // 焦点跳转：把目标文件滚动到面板中上位置（双 rAF 等展开布局稳定）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => focusScrollIntoPlace(true))
      })
    }
  }, [focusToken, defaultOpen, focusScrollRef])

  // 挂载即焦点：面板刚切到 git scope、数据异步加载完后文件行才挂载，
  // 此时 focusToken 已是最新值（令牌 effect 不会触发）——挂载时补一次滚动，
  // 保证第一次点击与后续点击的落点一致。首帧用瞬时定位避免动画竞态。
  useEffect(() => {
    if (!defaultOpen) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => focusScrollIntoPlace(false))
    })
  }, [])

  useEffect(() => {
    if (!open || file || fallbackChangeType !== 'added') return
    if (addedContent != null || addedUnavailable || !cwd) return
    let cancelled = false
    setAddedLoading(true)
    ipcClient
      .invoke('workspace.fs.readText', { workspaceRoot: cwd, path: filePath })
      .then((res: { ok?: boolean; content?: string }) => {
        if (cancelled) return
        if (res?.ok && typeof res.content === 'string') setAddedContent(res.content)
        else setAddedUnavailable(true)
      })
      .catch(() => {
        if (!cancelled) setAddedUnavailable(true)
      })
      .finally(() => {
        if (!cancelled) setAddedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, file, fallbackChangeType, cwd, filePath, addedContent, addedUnavailable])

  const toggleStage = useCallback(
    (_hunkIdx: number, hunk: DiffHunk) => {
      const patch = hunk.patch || ''
      if (!patch) return
      ipcClient
        .invoke(staged ? 'review.unstageHunks' : 'review.stageHunks', {
          cwd,
          files: [{ path: filePath, hunkPatches: [patch] }],
        })
        .then((res) => {
          if (res?.ok) onMutated()
        })
        .catch(() => {})
    },
    [staged, filePath, cwd, onMutated],
  )

  return (
    <div className="min-w-0 border-b border-border/30">
      <div
        ref={headerRef}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)]"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <ChangeIcon type={file?.status ?? fallbackChangeType} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{filePath}</span>
        {file && (
          <>
            <span className="shrink-0 text-[9px] text-[var(--diff-added)]">+{file.additions}</span>
            <span className="shrink-0 text-[9px] text-[var(--diff-removed)]">-{file.deletions}</span>
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void ipcClient.invoke('shell.openPath', { path: `${cwd}/${filePath}` })
          }}
          className="opacity-0 group-hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在编辑器打开"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            // showItemInFolder 需要绝对路径；git scope 的文件路径是仓库相对路径
            void ipcClient.invoke('shell.showItemInFolder', {
              path: cwd ? `${cwd}/${filePath}` : filePath,
            })
          }}
          className="opacity-0 group-hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在文件夹显示"
        >
          <FolderOpen className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="min-w-0 overflow-hidden border-t border-border/30 bg-[var(--bg-2)]">
          {file?.large && (
            <div className="px-3 py-1.5 text-[10px] text-amber-600/80">
              大变更（{file.additions + file.deletions} 行）
            </div>
          )}
          {file?.generated && <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60">生成文件</div>}
          {(!file || file.hunks.length === 0) && (
            addedContent != null ? (
              <div className="overflow-x-auto font-mono text-[10px] leading-[1.5]">
                {addedContent.split('\n').map((line, index) => (
                  <div key={index} className="diff-line-added flex whitespace-pre px-1">
                    <span className="w-3 shrink-0 select-none text-foreground-secondary/40">+</span>
                    <span className="min-w-0 flex-1">{line}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-3 text-[10px] text-muted-foreground/60">
                {addedLoading
                  ? '读取文件内容…'
                  : file?.binary
                    ? '二进制文件'
                    : file?.status === 'renamed'
                      ? `重命名自 ${file.oldPath || fallbackPath}`
                      : '无可显示文本差异'}
              </div>
            )
          )}
          {file?.hunks.map((hunk, hi) => (
            <DiffHunkView
              key={hi}
              hunk={hunk}
              hunkIndex={hi}
              mode={mode}
              staged={staged}
              onToggleStage={() => toggleStage(hi, hunk)}
              filePath={filePath}
              cwd={cwd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ReviewCommitBar({ cwd, onCommitted }: { cwd: string; onCommitted: () => void }) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)

  const handleCommit = () => {
    if (!message.trim()) return
    setCommitting(true)
    setError(null)
    ipcClient
      .invoke('review.commit', { cwd, message })
      .then((res) => {
        if (res?.ok) {
          setHash(res.commitHash || null)
          setMessage('')
          onCommitted()
        } else {
          setError(res?.error || '提交失败')
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setCommitting(false))
  }

  return (
    <div className="space-y-2 border-t border-border/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-foreground-secondary">
        <GitCommitHorizontal className="h-3.5 w-3.5" />
        提交已暂存
      </div>
      <textarea
        className="settings-field-focus w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]"
        rows={3}
        placeholder="commit message…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error && <div className="text-[10px] text-destructive">{error}</div>}
      {hash && <div className="text-[10px] text-[var(--diff-added)]">已提交 {hash.slice(0, 8)}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          className="settings-chip rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
          disabled={!message.trim() || committing}
          onClick={handleCommit}
        >
          {committing ? '提交中…' : '提交'}
        </button>
      </div>
    </div>
  )
}