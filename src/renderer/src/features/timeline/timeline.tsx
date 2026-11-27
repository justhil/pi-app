import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem, ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCircle2, XCircle,
  CornerDownLeft, AlertCircle,
  Copy, Pencil, Undo2, GitFork,
} from '@renderer/components/icons'
import { lazy, Suspense, useState, memo, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment, type MouseEvent as ReactMouseEvent } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SessionOpenLoadingView } from './session-open-loading'
import { ThinkingChainBlock } from './thinking-chain-block'
import { ReplyPlaceholder } from './reply-placeholder'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { buildTimelineDisplayItems, type TimelineDisplayItem, type TimelineRawItem } from './timeline-display-items'
import { MessageHoverActions, MessageHoverShell } from './message-hover-actions'
import { MessageInlineEditor } from './message-inline-editor'
import { registerTimelineScrollEl } from './timeline-scroll-bridge'
import { attachTimelineScrollHoverGuard } from './timeline-hover-guard'
import {
  TimelineContextMenuHost,
  closeTimelineContextMenu,
  getActiveTextSelection,
  openTimelineContextMenu,
  shouldBypassTimelineContextMenu,
  type TimelineContextMenuItem,
} from './timeline-context-menu'
import { rafThrottle } from '@renderer/lib/raf-throttle'
import { prependOlderTimelinePage } from '@renderer/lib/timeline-history-prepend'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import {
  SESSION_HISTORY_PAGE,
  fetchSessionHistoryOlder,
  fetchSessionHistoryTail,
} from '@renderer/lib/session-history'
import { prefetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
import { editSessionMessageInPlace } from '@renderer/lib/session-edit-message'
import { isSubagentSessionPreview } from '@renderer/lib/subagent-session-preview'
import { resolveRewindTargetEntryId, isInterruptedAssistantRow } from '@shared/timeline-incomplete'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import {
  TIMELINE_VIEW_ENTRY_EVENT,
  VIEW_REVEAL_CHUNK_LIMIT,
  isTargetNewerThanStore,
  missingOlderItems,
  planViewReveal,
  userSentSince,
  type TimelineViewEntryDetail,
} from './timeline-view-jump'
import {
  TIMELINE_LOAD_OLDER_SCROLL_TOP_PX,
  TIMELINE_STREAM_TAIL_PAD_PX,
  scheduleTimelineScrollToBottom,
  useTimelineLiveFollow,
} from './timeline-follow-scroll'
import { useSessionChrome } from '@renderer/lib/session-chrome'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import {
  requestTimelineBottomAnchor,
  useTimelineBottomAnchorController,
} from './timeline-bottom-anchor'
import { TimelineBottomAnchorButton } from './timeline-bottom-anchor-button'
import {
  nextTurnWindowStep,
  rowsForTurns,
  splitTimelineRenderSegments,
  sliceHistoryForViewport,
  turnsForRows,
} from './timeline-render-segments'
import {
  captureViewportAnchor,
  restoreViewportAnchor,
  startAnchorSettleGuard,
  type ViewportScrollAnchor,
} from './timeline-scroll-anchor'
import { pickAutoExpandedToolIds } from './timeline-tool-expand-policy'
import { groupDisplayBlocksByTurn } from './timeline-turn-groups'
import { TurnActivityBlock } from './turn-activity-block'
import { shouldShowTimelineHonestyBanner } from '@renderer/lib/timeline-honesty'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { type Segment } from '@renderer/features/composer/attachments'
import { isSessionPreviewComposeLocked } from '@renderer/lib/session-worker-sync'
import { UserMessageBubble } from './user-message-content'
import { TimelineSelectionToolbar } from './timeline-selection-toolbar'

const MarkdownView = lazy(() => import('./markdown-view'))

const TimelineItemBase = memo(function TimelineItem({
  item,
  prevType,
  streaming,
  agentRunning,
  agentBoot,
  rewindEntryId,
  /** Show hover action chrome (copy/edit/rewind). */
  showMessageActions = true,
  /** Mid-turn prose blocks float actions over the bottom edge without adding vertical gap. */
  floatingMessageActions = false,
  midTurnProse = false,
  isEditing = false,
  editDisabled = false,
  onStartEdit,
  onCancelEdit,
}: {
  item: TimelineRawItem
  prevType?: string
  streaming: boolean
  agentRunning: boolean
  agentBoot: boolean
  /** Pre-resolved incomplete-assistant / user rewind target for this row */
  rewindEntryId?: string
  showMessageActions?: boolean
  floatingMessageActions?: boolean
  midTurnProse?: boolean
  isEditing?: boolean
  editDisabled?: boolean
  onStartEdit?: (itemId: string) => void
  onCancelEdit?: () => void
}) {
  const { t } = useTranslation()
  const userMessageStyle = useUIStore((s) => s.timelineUserMessageStyle)
  const userActionAlign: 'left' | 'right' = userMessageStyle === 'prompt-card' ? 'left' : 'right'
  const rewindTargetFor = (row: TimelineRawItem): string | undefined =>
    rewindEntryId ?? (row.sessionEntryId as string | undefined)
  const ownEntryId = item.sessionEntryId as string | undefined

  const openMessageContextMenu = (
    e: ReactMouseEvent,
    opts: {
      role: 'user' | 'assistant'
      text: string
      editTargetId?: string
      rewindTarget?: string
      allowFork?: boolean
    },
  ) => {
    if (shouldBypassTimelineContextMenu(e.target)) return
    const selection = getActiveTextSelection()
    const menuItems: TimelineContextMenuItem[] = []
    if (selection) {
      menuItems.push({
        id: 'copy-selection',
        label: t('timeline:contextMenu.copySelection'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onSelect: () => void navigator.clipboard.writeText(selection),
      })
    }
    if (onStartEdit && opts.editTargetId) {
      menuItems.push({
        id: 'edit-message',
        label: t('timeline:editMessage'),
        icon: <Pencil className="h-3.5 w-3.5" />,
        disabled: editDisabled,
        onSelect: () => onStartEdit(String(item.id)),
      })
    }
    if (opts.text) {
      menuItems.push({
        id: 'copy-message',
        label: t('timeline:contextMenu.copyMessage'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onSelect: () => void navigator.clipboard.writeText(opts.text),
      })
    }
    if (opts.rewindTarget) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator', id: 'sep-nav' })
      menuItems.push({
        id: 'rewind-message',
        label: t('timeline:contextMenu.rewindToMessage'),
        icon: <Undo2 className="h-3.5 w-3.5" />,
        onSelect: () => void navigateSessionToEntry(opts.rewindTarget!),
      })
      if (opts.allowFork && opts.role === 'user') {
        menuItems.push({
          id: 'fork-message',
          label: t('timeline:forkFromHere'),
          icon: <GitFork className="h-3.5 w-3.5" />,
          onSelect: () => void forkSessionFromEntry(opts.rewindTarget!),
        })
      }
    }
    if (menuItems.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    openTimelineContextMenu({ x: e.clientX, y: e.clientY, items: menuItems })
  }

  if (item.type === 'user-message') {
    if (isEditing && ownEntryId) {
      return (
        <div className="timeline-message-row timeline-user-row">
          <MessageInlineEditor
            initialText={String(item.text ?? '')}
            role="user"
            align="right"
            onCancel={() => onCancelEdit?.()}
            onSave={(nextText) =>
              editSessionMessageInPlace({
                itemId: String(item.id),
                entryId: ownEntryId,
                text: nextText,
              })
            }
          />
        </div>
      )
    }

    const segments: Segment[] = (item.segments as Segment[] | undefined)?.length
      ? (item.segments as Segment[])
      : [{ type: 'text', text: String(item.text || '') }]
    return (
      <div
        data-pi-slot="timeline-user-row"
        className="timeline-message-row timeline-user-row"
        onContextMenu={(e) =>
          openMessageContextMenu(e, {
            role: 'user',
            text: String(item.text ?? ''),
            editTargetId: ownEntryId,
            rewindTarget: rewindTargetFor(item),
            allowFork: true,
          })
        }
      >
        <MessageHoverShell
          align={userActionAlign}
          reserve={showMessageActions}
          actions={
            showMessageActions ? (
              <MessageHoverActions
                text={String(item.text ?? '')}
                timestamp={Number(item.timestamp ?? 0)}
                align={userActionAlign}
                sessionEntryId={rewindTargetFor(item)}
                editEntryId={ownEntryId}
                editDisabled={editDisabled}
                onEdit={onStartEdit ? () => onStartEdit(String(item.id)) : undefined}
                onRewind={(id) => void navigateSessionToEntry(id)}
                onFork={(id) => void forkSessionFromEntry(id)}
              />
            ) : null
          }
        >
          <UserMessageBubble segments={segments} rawText={String(item.text ?? '')} />
        </MessageHoverShell>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    const hasText = !!String(item.text ?? '').trim()
    const hasThinking = !!String(item.thinkingText ?? '').trim()
    const sessionEntryId = item.sessionEntryId as string | undefined
    const isInterrupted = isInterruptedAssistantRow(item as { type?: string; incomplete?: boolean; stopReason?: string; text?: string; thinkingText?: string })
    // Empty incomplete leaf: rewind to previous user so session becomes continuable
    const resolvedRewindEntryId = rewindTargetFor(item)
    // Activity-density row: thinking-only (no prose) — no 32px hover slot, no message padding
    const isActivityThinkingOnly = hasThinking && !hasText && !isInterrupted
    // Mid-turn bridge prose is part of the same reply — no per-segment message chrome.
    const allowMessageActions = showMessageActions && !streaming

    if (!hasText && !hasThinking) {
      // Settled incomplete leaves (from an earlier abort/error) must stay static even when a later turn boots.
      if (isInterrupted && !streaming) {
        if (isEditing && sessionEntryId) {
          return (
            <div className="timeline-message-row timeline-prose-row">
              <MessageInlineEditor
                initialText=""
                role="assistant"
                align="left"
                forceAllowUnchanged
                onCancel={() => onCancelEdit?.()}
                onSave={(nextText) =>
                  editSessionMessageInPlace({
                    itemId: String(item.id),
                    entryId: sessionEntryId,
                    text: nextText,
                  })
                }
              />
            </div>
          )
        }
        return (
          <div
            className="timeline-message-row timeline-prose-row"
            onContextMenu={(e) =>
              openMessageContextMenu(e, {
                role: 'assistant',
                text: '',
                editTargetId: sessionEntryId,
                rewindTarget: resolvedRewindEntryId,
              })
            }
          >
            <MessageHoverShell
              align="left"
              actions={
                allowMessageActions ? (
                  <MessageHoverActions
                    text=""
                    timestamp={Number(item.timestamp ?? 0)}
                    align="left"
                    sessionEntryId={resolvedRewindEntryId}
                    editEntryId={sessionEntryId}
                    editDisabled={editDisabled}
                    onEdit={onStartEdit ? () => onStartEdit(String(item.id)) : undefined}
                    onRewind={(id) => void navigateSessionToEntry(id)}
                  />
                ) : null
              }
            >
              <div className="timeline-status-line timeline-status-line--warn text-[12px]">
                {/* A failed request (retries exhausted) keeps its reason when read back from history. */}
                {typeof item.errorMessage === 'string' && item.errorMessage.trim()
                  ? t('timeline:interruptedError', { error: item.errorMessage.trim() })
                  : t('timeline:interruptedEmpty', {
                      defaultValue: '回复未完成（程序关闭或中断）。可点回退到上一条后继续。',
                    })}
              </div>
            </MessageHoverShell>
          </div>
        )
      }
      // Optimistic / live wait: show thinking placeholder (not empty silence).
      if (streaming || agentBoot) {
        return (
          <div className="timeline-message-row timeline-activity-item">
            <ReplyPlaceholder
              startedAt={Number(item.timestamp ?? 0) || undefined}
              labelSeed={String(item.id)}
            />
          </div>
        )
      }
      // Empty tool-bridge residue (should usually be absorbed by display clustering)
      return null
    }

    const proseBody = (
      <>
        {hasThinking && (
          <ThinkingChainBlock
            text={String(item.thinkingText ?? '')}
            streaming={streaming}
            startedAt={Number(item.timestamp ?? 0) || undefined}
            duration={Number(item.thinkingDuration ?? 0) || undefined}
            labelSeed={String(item.id)}
          />
        )}
        {hasText ? (
          <div
            data-pi-slot={midTurnProse ? 'timeline-mid-prose' : undefined}
            className={cn(
              'min-w-0 timeline-text-body',
              streaming && 'assistant-stream-live',
            )}
          >
            <Suspense fallback={<p className="whitespace-pre-wrap break-words">{String(item.text ?? '')}</p>}>
              <MarkdownView streaming={streaming}>{String(item.text ?? '')}</MarkdownView>
            </Suspense>
          </div>
        ) : isInterrupted && !hasText ? (
          <div className="text-[12px] timeline-text-quiet">
            {t('timeline:interruptedPartial')}
          </div>
        ) : null}
      </>
    )

    if (isEditing && sessionEntryId) {
      return (
        <div className="timeline-message-row timeline-prose-row">
          {hasThinking && (
            <ThinkingChainBlock
              text={String(item.thinkingText ?? '')}
              streaming={streaming}
              startedAt={Number(item.timestamp ?? 0) || undefined}
              duration={Number(item.thinkingDuration ?? 0) || undefined}
              labelSeed={String(item.id)}
            />
          )}
          <MessageInlineEditor
            initialText={String(item.text ?? '')}
            role="assistant"
            align="left"
            forceAllowUnchanged={isInterrupted}
            onCancel={() => onCancelEdit?.()}
            onSave={(nextText) =>
              editSessionMessageInPlace({
                itemId: String(item.id),
                entryId: sessionEntryId,
                text: nextText,
              })
            }
          />
        </div>
      )
    }

    return (
      <div
        data-pi-slot={isActivityThinkingOnly ? undefined : 'timeline-prose-row'}
        className={cn(
          'timeline-message-row',
          isActivityThinkingOnly ? 'timeline-activity-item' : 'timeline-prose-row',
        )}
        onContextMenu={
          streaming || isActivityThinkingOnly
            ? undefined
            : (e) =>
                openMessageContextMenu(e, {
                  role: 'assistant',
                  text: String(item.text ?? ''),
                  editTargetId: sessionEntryId,
                  rewindTarget: isInterrupted && !hasText ? resolvedRewindEntryId : sessionEntryId,
                })
        }
      >
        <MessageHoverShell
          align="left"
          floating={floatingMessageActions}
          actions={
            allowMessageActions && !isActivityThinkingOnly ? (
              <MessageHoverActions
                text={String(item.text ?? '')}
                timestamp={Number(item.timestamp ?? 0)}
                align="left"
                sessionEntryId={isInterrupted && !hasText ? resolvedRewindEntryId : sessionEntryId}
                editEntryId={sessionEntryId}
                editDisabled={editDisabled}
                onEdit={onStartEdit ? () => onStartEdit(String(item.id)) : undefined}
                onRewind={(id) => void navigateSessionToEntry(id)}
              />
            ) : null
          }
        >
          {proseBody}
        </MessageHoverShell>
      </div>
    )
  }

  if (item.type === 'slash') {
    const status = item.slashStatus || 'dispatched'
    const rawSlashText = String(item.text ?? '')
    const slashText =
      rawSlashText === '已发送给 pi 执行'
        ? t('timeline:slashSentToPi')
        : rawSlashText === '命令已执行（详见下方助手/工具输出）'
          ? t('timeline:slashExecutedDetail')
          : rawSlashText.startsWith('执行失败:')
            ? t('timeline:slashExecFailed', { error: rawSlashText.slice('执行失败:'.length).trim() })
            : rawSlashText
    const iconCls =
      status === 'error'
        ? 'text-destructive/70'
        : status === 'ok'
          ? 'text-emerald-600/70 dark:text-emerald-400/70'
          : 'timeline-text-quiet'
    const Icon = status === 'error' ? XCircle : status === 'ok' ? CheckCircle2 : CornerDownLeft
    const label =
      status === 'error'
        ? t('timeline:statusFailed')
        : status === 'ok'
          ? t('timeline:statusDone')
          : rawSlashText.includes('失败') || rawSlashText.startsWith('Execution failed:')
            ? t('timeline:statusFailed')
            : t('timeline:statusExecuted')
    return (
      <div className="py-1">
        <div className="timeline-status-line">
          <Icon className={cn('h-3 w-3 shrink-0', iconCls)} />
          <span className="font-mono text-[12px] timeline-text-secondary">{String(item.slashCommand ?? '')}</span>
          <span className={cn('text-[11px]', iconCls)}>{label}</span>
          {slashText.length > 0 && (
            <span className="truncate timeline-text-quiet">{slashText}</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'compaction') {
    return (
      <div className="py-1.5">
        <div className="timeline-status-line">
          <Archive className="h-3 w-3 shrink-0 timeline-text-placeholder" />
          <span className="text-[12px] timeline-text-quiet">{t('timeline:compacted')}</span>
          {String(item.text ?? '').length > 0 && (
            <span className="truncate text-[11px] timeline-text-placeholder">
              {String(item.text ?? '').slice(0, 100)}...
            </span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'error') {
    const kind = item.errorKind as string | undefined
    const isAbort = kind === 'aborted'
    const title = isAbort
      ? t('timeline:aborted')
      : kind === 'retry'
        ? t('timeline:retryFailed')
        : t('timeline:runError')
    return (
      <div className="py-1.5">
        <div className={cn('timeline-status-line', isAbort ? 'timeline-status-line--warn' : 'timeline-status-line--error')}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0 opacity-80" />
          <span className="text-[12px] font-medium">{title}</span>
        </div>
        {item.text != null && String(item.text) && (
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-transparent pl-2.5 font-mono text-[11px] leading-relaxed timeline-text-quiet">
            {String(item.text)}
          </pre>
        )}
      </div>
    )
  }

  return null
})

export function Timeline() {
  const items = useUIStore((s) => s.timelineItems)
  const streamingAssistantId = useUIStore((s) => s.streamingAssistantId)
  // Bucket stream length so jump-to-bottom button / follow deps don't thrash every token.
  const streamingTailBucket = useUIStore((s) => {
    if (!s.streamingAssistantId) return 0
    const item = s.timelineItems.find((i) => i.id === s.streamingAssistantId)
    const len = (item?.text?.length ?? 0) + (item?.thinkingText?.length ?? 0)
    return Math.floor(len / 64)
  })
  const extensionDialogOpen = useExtensionUIStore((s) => s.activePending != null)
  const sessionChrome = useSessionChrome({ extensionDialogOpen })
  const agentRunning = sessionChrome.canStop || sessionChrome.showSpinner
  const agentBoot = useUIStore((s) => s.agentTurnBootstrapping)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const hasWorkspace = !!currentWorkspace || ephemeralDraft
  const isEphemeralEmpty = ephemeralDraft && !currentWorkspace
  const historyTotalCount = useUIStore((s) => s.historyTotalCount)
  const historyLoadedCount = useUIStore((s) => s.historyLoadedCount)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const readOnlySubagentPreview = useUIStore((s) =>
    isSubagentSessionPreview(s.subagentSessionGroup, s.historySessionFile),
  )
  const historyLoading = useUIStore((s) => s.historyLoading)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const timelineMaxAutoExpandedTools = useUIStore((s) => s.timelineMaxAutoExpandedTools)
  const { t } = useTranslation()

  // Virtualization by user turns: render everything inside the last N user turns (setting,
  // default 10) and reveal N more on scroll up — a turn is never cut in the middle, however
  // many tool calls it has. The window belongs to one session (after vastsa/pi-desktop D261):
  // a switch first commits a small tail so the destination paints fast, then grows to the
  // steady window after paint; a window grown in the previous session never carries over.
  const PAGE_TURNS = useUIStore((s) => s.timelineVisibleTurns)
  const FIRST_PAINT_TURNS = Math.min(2, PAGE_TURNS)
  const [windowState, setWindowState] = useState<{ sessionFile: string | null; count: number }>(() => ({
    sessionFile: historySessionFile ?? null,
    count: PAGE_TURNS,
  }))
  const windowSessionFile = historySessionFile ?? null
  const windowTurns =
    windowState.sessionFile === windowSessionFile ? windowState.count : FIRST_PAINT_TURNS
  const windowSessionRef = useRef(windowSessionFile)
  windowSessionRef.current = windowSessionFile
  const setWindowTurns = useCallback((update: number | ((turns: number) => number)) => {
    setWindowState((previous) => {
      const sessionFile = windowSessionRef.current
      const base = previous.sessionFile === sessionFile ? previous.count : FIRST_PAINT_TURNS
      const count = typeof update === 'function' ? update(base) : update
      return previous.sessionFile === sessionFile && previous.count === count
        ? previous
        : { sessionFile, count }
    })
  }, [FIRST_PAINT_TURNS])
  const segments = useMemo(
    () => splitTimelineRenderSegments(items, { streamingAssistantId, agentRunning }),
    [items, streamingAssistantId, agentRunning],
  )
  /** Rows of history the turn window covers (what the row-based reveal/jump logic works in). */
  const renderCount = useMemo(() => rowsForTurns(segments.history, windowTurns), [segments, windowTurns])
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const canQuote = useUIStore((s) => {
    const canCompose = !!s.currentWorkspace || s.ephemeralSandboxDraft
    if (!canCompose) return false
    const locked =
      !s.ephemeralSandboxDraft &&
      !s.pendingNewSessionPlaceholder &&
      !!s.historySessionFile &&
      isSessionPreviewComposeLocked(
        s.historySessionFile,
        s.workerLiveSnapshot.sessionFile,
        s.workerLiveSnapshot.status,
        readOnlySubagentPreview,
      )
    return !locked
  })

  // ---- Non-destructive view jumps from the session tree (click = view, dblclick = rewind) ----
  const viewSeqRef = useRef(0)
  const viewLoadRef = useRef<Promise<void> | null>(null)
  const viewTailSnapshotRef = useRef<{ id?: string; type?: string } | null>(null)
  const viewLandedRef = useRef<{ entryId: string; seq: number } | null>(null)
  const [viewTarget, setViewTarget] = useState<string | null>(null)
  const [editingState, setEditingState] = useState<{ sessionFile: string | null; itemId: string } | null>(null)
  const handleStartEdit = useCallback(
    (itemId: string) => setEditingState({ sessionFile: windowSessionRef.current, itemId }),
    [],
  )
  const handleCancelEdit = useCallback(() => setEditingState(null), [])
  const lastTailId = items[items.length - 1]?.id
  // contentEpoch intentionally ignores raw stream text length — height growth is observed.
  const contentEpoch = `${lastTailId ?? ''}:${renderCount}:${historySessionFile ?? ''}`
  const { followLiveRef, syncFollowFromScroll, onUserScrollIntent } = useTimelineLiveFollow(
    scrollRef,
    contentRef,
    {
      lastTailId,
      streamingAssistantId,
      streamingTailLen: streamingTailBucket,
      contentEpoch,
      agentRunning,
    },
  )
  useTimelineBottomAnchorController(scrollRef, followLiveRef, historySessionFile)

  // When a session skeleton finishes loading (cold open / switch-back), the
  // session-enter anchor above may have run while scrollRef was still null
  // (loading view renders no scroll pane), so the pin was lost. Re-anchor once
  // the pane exists so the viewport lands on the latest content.
  const prevHistoryLoadingRef = useRef(historyLoading)
  useEffect(() => {
    const wasLoading = prevHistoryLoadingRef.current
    prevHistoryLoadingRef.current = historyLoading
    if (wasLoading && !historyLoading && historySessionFile) {
      requestTimelineBottomAnchor('session-enter')
    }
  }, [historyLoading, historySessionFile])

  // View-jump listener: the tree side only dispatches an entry id; reveal logic
  // lives here because the viewport (renderCount / scrollRef / items) is local.
  useEffect(() => {
    const onViewEntry = (e: Event) => {
      const detail = (e as CustomEvent<TimelineViewEntryDetail>).detail
      const entryId = detail?.entryId
      if (!entryId || typeof entryId !== 'string') return
      viewSeqRef.current += 1
      viewLandedRef.current = null
      viewTailSnapshotRef.current = useUIStore.getState().timelineItems.at(-1) ?? null
      // A view jump is a navigation away from the leaf: detach live-follow so the
      // follow controller never pins the viewport back to the bottom after the reveal.
      followLiveRef.current = false
      setViewTarget(entryId)
    }
    window.addEventListener(TIMELINE_VIEW_ENTRY_EVENT, onViewEntry)
    return () => window.removeEventListener(TIMELINE_VIEW_ENTRY_EVENT, onViewEntry)
  }, [followLiveRef])

  // Reveal a pending view target: scroll when rendered, expand the virtual
  // window when loaded, or fetch a bounded read-only chunk when not loaded.
  // Any user interaction (wheel, sending a message, a newer request) cancels it.
  useLayoutEffect(() => {
    if (!viewTarget) return
    const seq = viewSeqRef.current
    const el = scrollRef.current
    if (el) {
      const entryId = viewTarget
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(entryId) : entryId
      const row = el.querySelector(`[data-session-entry-id="${escaped}"]`)
      if (row) {
        followLiveRef.current = false
        row.scrollIntoView({ block: 'center' })
        window.dispatchEvent(new Event('timeline-scroll'))
        viewSeqRef.current += 1
        // Remember the landing: if a later store replacement (e.g. a late
        // session-shell hydrate bind) removes the target from the store, the
        // self-heal effect below re-plans so the jump is not undone.
        viewLandedRef.current = { entryId, seq: viewSeqRef.current }
        setViewTarget(null)
        return
      }
    }

    const st = useUIStore.getState()
    const all = st.timelineItems
    const plan = planViewReveal(viewTarget, all, renderCountRef.current, st.historySessionFile)
    if (plan.kind === 'none' && plan.reason === 'covered' && el) {
      // The target is inside the render window, so its row is in the DOM — but
      // possibly without a data-session-entry-id (optimistic placeholder whose
      // entry id never arrived). Fall back to the item-id anchor so the click
      // still lands on the message instead of silently doing nothing.
      const targetItem = all.find(
        (it) => it.sessionEntryId === viewTarget || it.id === viewTarget,
      )
      const anchor = targetItem
        ? el.querySelector(`[data-item-id="${CSS.escape(String(targetItem.id))}"]`)
        : null
      if (anchor) {
        followLiveRef.current = false
        anchor.scrollIntoView({ block: 'center' })
        window.dispatchEvent(new Event('timeline-scroll'))
        viewSeqRef.current += 1
        viewLandedRef.current = { entryId: viewTarget, seq: viewSeqRef.current }
      }
      setViewTarget(null)
      return
    }
    if (plan.kind === 'scroll') {
      const needed = turnsForRows(all, plan.requiredRenderCount)
      setWindowTurns((turns) => Math.max(turns, needed))
      return
    }
    if (plan.kind === 'load') {
      if (viewLoadRef.current) return
      const sessionFile = st.historySessionFile
      if (!sessionFile) return
      const navToken = getSessionNavigationToken()
      const stillCurrent = () => isSessionNavigationCurrent(navToken) && seq === viewSeqRef.current &&
        sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)
      const captured = viewTailSnapshotRef.current
      const tail = all.at(-1) ?? null
      const load: Promise<void> = (async () => {
        const res = await fetchSessionHistoryTail(sessionFile, VIEW_REVEAL_CHUNK_LIMIT, {
          leafId: plan.entryId,
          bypassCache: true,
        })
        if (!stillCurrent()) return
        const chunk = (res.items || []) as TimelineItem[]
        if (!chunk.length) return
        if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
        if (isTargetNewerThanStore(chunk, tail)) return

        // The leaf-anchored fetch reports the target's absolute position (branch
        // length). When the loaded tail does not start right above the target, fetch
        // the tail-anchored remainder so the store stays contiguous — otherwise a
        // hole is left between the target region and the tail, corrupting later
        // offset-based older-loading.
        let allFetched: TimelineItem[] = chunk
        const targetPos = typeof res.totalCount === 'number' ? res.totalCount : 0
        const pre = useUIStore.getState()
        const total = pre.historyTotalCount
        if (targetPos > 0 && total > targetPos) {
          const gap = total - targetPos
          // Request up to 500 rows; the tail can extend to a turn's user message.
          const tailRes = await fetchSessionHistoryTail(sessionFile, Math.min(gap, 500), { leafId: null })
          if (!stillCurrent()) return
          if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
          const tailItems = (tailRes.items || []) as TimelineItem[]
          allFetched = [...missingOlderItems(chunk, tailItems), ...tailItems]
          // When the target is further than 500 items below the loaded tail, the
          // gap fetch leaves a hole between the target and the tail. Close it with
          // offset-based pages (max 500 each), oldest-first, looping until the
          // hole is contiguous — a single page would still leave a gap while the
          // loadedCount below claims full coverage and blocks older-loading.
          // Tail pages can extend to the containing user message.
          const holeLength = Math.max(0, gap - tailRes.sourceCount)
          if (holeLength > 0) {
            const middle: TimelineItem[] = []
            let holeStart = targetPos + 1
            let remaining = holeLength
            while (remaining > 0) {
              const pageLen = Math.min(remaining, 500)
              // offset 语义：距尾部倒数第 offset 条之后的 pageLen 条
              const offsetFromTail = total - (holeStart + pageLen - 1)
              const pageRes = await fetchSessionHistoryOlder(sessionFile, offsetFromTail, pageLen)
              if (!stillCurrent()) return
              if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
              const page = (pageRes.items || []) as TimelineItem[]
              if (!page.length) break
              middle.push(...page)
              holeStart += page.length
              remaining -= page.length
            }
            allFetched = [...chunk, ...middle, ...tailItems]
          }
        }
        const latest = useUIStore.getState()
        const missing = missingOlderItems(allFetched, latest.timelineItems)
        if (missing.length) {
          latest.prependHistoryItems(missing)
          const after = useUIStore.getState()
          // Recompute loadedCount from the true coverage: everything from the chunk
          // start (targetPos - chunkLen + 1) through the leaf is now loaded. This
          // keeps the older-loader's offset honest so it never fetches pages that
          // overlap or fall out of order.
          if (after.historyTotalCount > 0) {
            const chunkLen = res.sourceCount
            const covered = after.historyTotalCount - (targetPos - chunkLen)
            useUIStore.setState({
              historyLoadedCount: Math.min(
                after.historyTotalCount,
                Math.max(after.historyLoadedCount, covered),
              ),
            })
          }
        }
      })()
        .catch((error: unknown) => {
          console.error('[Timeline] view-entry load failed', error)
        })
        .finally(() => {
          if (viewLoadRef.current === load) viewLoadRef.current = null
        })
      viewLoadRef.current = load
    }
  }, [viewTarget, renderCount, items, historySessionFile])

  // Self-heal: a view jump that already landed must survive a store replacement
  // that drops its target (late hydrate bind, focus re-bind, …). When the landed
  // entry vanishes from the store, re-plan the reveal instead of leaving the
  // viewport on unrelated content.
  useEffect(() => {
    const landed = viewLandedRef.current
    if (!landed) return
    if (viewSeqRef.current !== landed.seq) {
      viewLandedRef.current = null
      return
    }
    const present = useUIStore
      .getState()
      .timelineItems.some((it) => it.sessionEntryId === landed.entryId || it.id === landed.entryId)
    if (present) return
    viewLandedRef.current = null
    setViewTarget(landed.entryId)
  }, [items, viewTarget])

  // The scroll container is absent while a session shows its loading skeleton and appears
  // later without any of the deps below changing; track the node itself so registration and
  // listeners follow it (otherwise an older session opened from disk was never registered).
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (scrollRef.current !== scrollNode) setScrollNode(scrollRef.current)
  })

  useEffect(() => {
    const el = scrollNode
    registerTimelineScrollEl(el)
    if (!el) return () => registerTimelineScrollEl(null)
    const notify = rafThrottle(() => {
      closeTimelineContextMenu()
      window.dispatchEvent(new Event('timeline-scroll'))
    })
    el.addEventListener('scroll', notify, { passive: true })
    const detachHoverGuard = attachTimelineScrollHoverGuard(el)
    // Upward wheel detaches live-follow immediately so stream growth never fights the user.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        onUserScrollIntent(e.deltaY)
        // A pending view jump yields to the user's own scroll.
        viewSeqRef.current += 1
        viewLandedRef.current = null
        setViewTarget(null)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    const ro = new ResizeObserver(notify)
    ro.observe(el)
    notify()
    return () => {
      detachHoverGuard()
      registerTimelineScrollEl(null)
      el.removeEventListener('scroll', notify)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
    }
  }, [hasWorkspace, onUserScrollIntent, historySessionFile, scrollNode])
  const pendingAnchorRef = useRef<ViewportScrollAnchor | null>(null)
  const settleGuardCleanupRef = useRef<(() => void) | null>(null)
  const renderCountRef = useRef(renderCount)
  renderCountRef.current = renderCount
  const windowTurnsRef = useRef(windowTurns)
  windowTurnsRef.current = windowTurns

  const [fetchingOlder, setFetchingOlder] = useState(false)
  const olderLoadSeqRef = useRef(0)

  const clearSettleGuard = useCallback(() => {
    settleGuardCleanupRef.current?.()
    settleGuardCleanupRef.current = null
  }, [])

  useEffect(() => clearSettleGuard, [clearSettleGuard])

  const loadMoreHistory = useCallback((grow = true) => {
    const el = scrollRef.current
    // Concurrent click / scroll-triggered load guard (do not use scroll-anchor as a permanent lock).
    if (!el || fetchingOlder) return

    const st = useUIStore.getState()
    const current = renderCountRef.current
    const all = st.timelineItems
    const segs = splitTimelineRenderSegments(all, {
      streamingAssistantId: st.streamingAssistantId,
      agentRunning: st.runState.status === 'running',
    })

    const canFetchDisk =
      !!st.historySessionFile && st.historyLoadedCount < st.historyTotalCount
    const canRevealInMemory = current < segs.history.length

    if (!canFetchDisk && !canRevealInMemory) return

    // Prefer 0ms in-memory reveal when RAM already holds enough buffered rows to cover the
    // full step without hitting the end of loaded items (or when disk has nothing more).
    // When the step reaches the end of the RAM buffer and disk has older pages, fetch now so
    // one scroll/click seamlessly loads and reveals a full batch.
    if (grow && canRevealInMemory) {
      const maxStep = st.timelineVisibleTurns
      const targetTurns = nextTurnWindowStep(segs.history, windowTurnsRef.current, maxStep)
      const revealedRows = rowsForTurns(segs.history, targetTurns)
      const hitBufferCeiling = revealedRows >= segs.history.length
      if (!canFetchDisk || !hitBufferCeiling) {
        pendingAnchorRef.current = captureViewportAnchor(el)
        setWindowTurns(targetTurns)
        if (canFetchDisk && segs.history.length - revealedRows <= 36) {
          prefetchTimelineHistoryPage(st.historySessionFile!, st.historyLoadedCount)
        }
        return
      }
    }

    if (canFetchDisk) {
      const loadSeq = ++olderLoadSeqRef.current
      setFetchingOlder(true)
      const fetchStartScrollHeight = el.scrollHeight
      const offset = st.historyLoadedCount
      const sessionFile = st.historySessionFile!
      const navToken = getSessionNavigationToken()
      const stillCurrent = () => isSessionNavigationCurrent(navToken) &&
        sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)
      void prependOlderTimelinePage(sessionFile, offset, SESSION_HISTORY_PAGE, {
        onBeforeCommit: ({ nextTimelineItems }) => {
          if (loadSeq !== olderLoadSeqRef.current || !stillCurrent()) return
          const curEl = scrollRef.current
          if (curEl) {
            // Capture the DOM viewport anchor at the exact commit instant (never stale across
            // async IPC, even if the user kept scrolling while the fetch was in flight).
            pendingAnchorRef.current = captureViewportAnchor(curEl, {
              fallbackScrollHeight: fetchStartScrollHeight,
            })
          }
          if (grow) {
            const latest = useUIStore.getState()
            const nextSegs = splitTimelineRenderSegments(nextTimelineItems, {
              streamingAssistantId: latest.streamingAssistantId,
              agentRunning: latest.runState.status === 'running',
            })
            const maxStep = latest.timelineVisibleTurns
            // Batched in the same tick as `useUIStore.setState` so prepend + window growth
            // land in ONE single atomic React commit (zero anchor wipe / zero jump).
            setWindowTurns((turns) => nextTurnWindowStep(nextSegs.history, turns, maxStep))
          }
        },
      })
        .then(({ items: older, error, cancelled }) => {
          if (cancelled || !stillCurrent()) {
            if (loadSeq === olderLoadSeqRef.current) pendingAnchorRef.current = null
            return
          }
          if (error) {
            console.error('[Timeline] load older failed', error)
            pendingAnchorRef.current = null
            return
          }
          if (!older.length) {
            // Empty page: unlock and stop pretending more disk history exists.
            pendingAnchorRef.current = null
            const latest = useUIStore.getState()
            if (latest.historyLoadedCount < latest.historyTotalCount) {
              useUIStore.setState({ historyLoadedCount: latest.historyTotalCount })
            }
          }
        })
        .catch((error) => {
          if (!stillCurrent()) return
          console.error('[Timeline] load older failed', error)
          pendingAnchorRef.current = null
        })
        .finally(() => { if (loadSeq === olderLoadSeqRef.current) setFetchingOlder(false) })
    }
  }, [fetchingOlder, setWindowTurns])

  const visibleItems = useMemo(() => {
    const historyWindow = sliceHistoryForViewport(segments.history, renderCount)
    return [...historyWindow, ...segments.liveHead]
  }, [segments, renderCount])
  const visibleHeadId = visibleItems[0]?.id ?? null

  // Restore scroll anchor ONLY when the actually mounted DOM slice (`visibleItems`) prepends rows —
  // never prematurely on a store buffer update whose rows are still hidden outside the window.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const anchor = pendingAnchorRef.current
    if (!el || anchor == null) return
    pendingAnchorRef.current = null
    clearSettleGuard()
    if (followLiveRef.current) {
      scheduleTimelineScrollToBottom(el)
      return
    }
    restoreViewportAnchor(el, anchor)
    settleGuardCleanupRef.current = startAnchorSettleGuard(
      el,
      contentRef.current,
      anchor,
      () => followLiveRef.current,
    )
  }, [visibleHeadId, visibleItems.length, clearSettleGuard, followLiveRef])

  // Reset the virtualization window only when the session file changes — not when
  // older messages are prepended (that changes items[0].id and must not reset).
  const prevSessionFileRef = useRef<string | null>(null)
  useEffect(() => {
    setWindowTurns(FIRST_PAINT_TURNS)
    pendingAnchorRef.current = null
    clearSettleGuard()
    olderLoadSeqRef.current += 1
    setFetchingOlder(false)
    const prevFile = prevSessionFileRef.current
    prevSessionFileRef.current = historySessionFile ?? null
    // First hydration (null → file): keep a pending view jump so it re-plans
    // against the freshly loaded store. A real session switch drops the old jump
    // and cancels its in-flight fetch.
    if (prevFile != null) {
      viewSeqRef.current += 1
      viewLoadRef.current = null
      viewLandedRef.current = null
      setViewTarget(null)
    }
    followLiveRef.current = true
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) scheduleTimelineScrollToBottom(el)
    })
    // Grow to the steady window once the small first commit has painted; anchor the viewport so
    // rows added above do not move what the user is looking at.
    let growFrame = requestAnimationFrame(() => {
      growFrame = requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) pendingAnchorRef.current = captureViewportAnchor(el)
        setWindowTurns((turns) => Math.max(turns, useUIStore.getState().timelineVisibleTurns))
      })
    })
    return () => cancelAnimationFrame(growFrame)
  }, [historySessionFile, followLiveRef, setWindowTurns, clearSettleGuard])

  // Fill: when the window asks for more turns than the loaded history holds and the disk
  // has more, fetch older pages without growing the window again (initial load included).
  // Yields to view jumps and session loads (they fetch history themselves; two concurrent
  // prepends would duplicate rows) and re-checks one frame later before fetching.
  useEffect(() => {
    if (fetchingOlder || historyLoading || viewTarget || !historySessionFile || historyLoadedCount >= historyTotalCount) return
    let loadedTurns = 0
    for (const it of items) if (it.type === 'user-message') loadedTurns++
    if (loadedTurns >= windowTurns) return
    const frame = requestAnimationFrame(() => {
      if (viewLoadRef.current) return
      loadMoreHistory(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [fetchingOlder, historyLoading, viewTarget, historySessionFile, historyLoadedCount, historyTotalCount, items, windowTurns, loadMoreHistory])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    syncFollowFromScroll()
    const storeState = useUIStore.getState()
    const canFetch = !!storeState.historySessionFile && storeState.historyLoadedCount < storeState.historyTotalCount

    // Warm the next disk page silently in the approach zone before hitting the reveal threshold.
    if (
      !followLiveRef.current &&
      canFetch &&
      el.scrollTop >= TIMELINE_LOAD_OLDER_SCROLL_TOP_PX &&
      el.scrollTop < TIMELINE_LOAD_OLDER_SCROLL_TOP_PX * 2.4
    ) {
      const segs = splitTimelineRenderSegments(storeState.timelineItems, {
        streamingAssistantId: storeState.streamingAssistantId,
        agentRunning: storeState.runState.status === 'running',
      })
      if (segs.history.length - renderCountRef.current <= 36) {
        prefetchTimelineHistoryPage(storeState.historySessionFile!, storeState.historyLoadedCount)
      }
    }

    // Skip reveal/fetch work unless the viewport is near the older-history threshold.
    if (el.scrollTop >= TIMELINE_LOAD_OLDER_SCROLL_TOP_PX) return
    const segs = splitTimelineRenderSegments(storeState.timelineItems, {
      streamingAssistantId: storeState.streamingAssistantId,
      agentRunning: storeState.runState.status === 'running',
    })
    const canReveal = renderCountRef.current < segs.history.length
    if (canReveal || canFetch) {
      loadMoreHistory()
    }
  }, [followLiveRef, loadMoreHistory, syncFollowFromScroll])

  const toolExpandSlots = useMemo(
    () =>
      visibleItems
        .filter((row) => row.type === 'tool-call')
        .map((row) => {
          const toolRow = row as ToolTimelineItem
          return { id: toolRow.id, runId: toolRow.runId, toolPhase: toolRow.toolPhase, suspended: !!toolRow.extensionUiSuspended }
        }),
    [visibleItems],
  )
  const autoExpandedToolIds = useMemo(
    () =>
      pickAutoExpandedToolIds(toolExpandSlots, {
        agentRunning,
        activeRunId,
        maxExpanded: timelineMaxAutoExpandedTools,
      }),
    [toolExpandSlots, agentRunning, activeRunId, timelineMaxAutoExpandedTools],
  )
  // Structure-only fingerprint: stream text must not rebuild timings / rewind targets.
  const structureEpoch = useMemo(
    () =>
      items
        .map((row) => {
          if (row.type === 'assistant-message') {
            const incomplete = (row as { incomplete?: boolean }).incomplete ? '1' : '0'
            const stop = String((row as { stopReason?: string }).stopReason || '')
            return `${row.id}:a:${row.sessionEntryId ?? ''}:${incomplete}:${stop}`
          }
          if (row.type === 'tool-call') {
            const tool = row as ToolTimelineItem
            return `${row.id}:t:${tool.toolPhase ?? ''}:${tool.toolName ?? ''}`
          }
          return `${row.id}:${row.type}:${row.sessionEntryId ?? ''}:${row.timestamp ?? 0}`
        })
        .join('|'),
    [items],
  )
  const isSessionTurnLive =
    !!streamingAssistantId || agentRunning || agentBoot || sessionChrome.phase === 'waiting_ui'
  const editDisabled = isSessionTurnLive || readOnlySubagentPreview
  const activeEditingItemId =
    editingState &&
    editingState.sessionFile === (historySessionFile ?? null) &&
    !editDisabled
      ? editingState.itemId
      : null
  const onStartEditRow = readOnlySubagentPreview ? undefined : handleStartEdit
  // Grouping is cheap and must see live item references (streaming text).
  const displayItems = useMemo(
    () =>
      buildTimelineDisplayItems(visibleItems as unknown as TimelineRawItem[], {
        turnSettled: !isSessionTurnLive,
      }),
    [visibleItems, isSessionTurnLive],
  )
  const { leading, turns: turnGroups } = useMemo(
    () => groupDisplayBlocksByTurn(displayItems),
    [displayItems],
  )

  const rewindEntryByItemId = useMemo(() => {
    const map = new Map<string, string | undefined>()
    const raw = items as unknown as TimelineRawItem[]
    for (const row of raw) {
      if (row.type === 'user-message' || row.type === 'assistant-message') {
        map.set(row.id, resolveRewindTargetEntryId(raw, row))
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: structureEpoch only
  }, [structureEpoch])

  if (!hasWorkspace) {
    return (
      <EmptyState
        title={t('timeline:emptyWorkspace')}
        description={t('timeline:emptyHint')}
      />
    )
  }

  const historyLoadMiss =
    !historyLoading &&
    !!historySessionFile &&
    items.length === 0 &&
    historyTotalCount > 0

  if (items.length === 0) {
    // Skeleton ONLY while explicitly loading. Do not treat "empty after rewind to first
    // message" (historyTotalCount=0, session still selected) as loading — that was a stuck spinner.
    if (historyLoading) {
      return <SessionOpenLoadingView key={historySessionFile ?? 'loading'} />
    }
    if (historyLoadMiss) {
      return (
        <EmptyState
          title={t('timeline:historyIncomplete')}
          description={t('timeline:historyIncompleteHint', { count: historyTotalCount })}
        >
          <button
            type="button"
            className="mt-2 rounded-md border border-border/50 px-3 py-1.5 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={() => void reloadCurrentSessionData()}
          >
            {t('timeline:honestyReload')}
          </button>
        </EmptyState>
      )
    }
    return (
      <EmptyState
        title={isEphemeralEmpty ? t('timeline:newChat') : t('timeline:placeholder')}
        description={isEphemeralEmpty ? t('timeline:firstMessageHint') : t('timeline:emptyHint')}
      />
    )
  }

  const historyWindow = sliceHistoryForViewport(segments.history, renderCount)
  const hiddenInMemory = Math.max(0, segments.history.length - historyWindow.length)
  const hiddenOnServer = Math.max(0, historyTotalCount - historyLoadedCount)
  const hiddenCount = hiddenOnServer + hiddenInMemory
  const showHonestyBanner = shouldShowTimelineHonestyBanner({
    items: items as TimelineItem[],
    historyTotalCount,
    historyLoadedCount,
    historyLoading,
    historySessionFile,
  })

  const renderDisplayBlock = (
    block: TimelineDisplayItem,
    blockKey: string,
    opts?: {
      showMessageActions?: boolean
      floatingMessageActions?: boolean
      midTurnProse?: boolean
      allowBootPlaceholder?: boolean
    },
  ) => {
    const showMessageActions = opts?.showMessageActions !== false
    const floatingMessageActions = !!opts?.floatingMessageActions
    const midTurnProse = !!opts?.midTurnProse
    const rowAgentBoot = agentBoot && !!opts?.allowBootPlaceholder
    if (block.kind === 'tool-group') {
      const groupThinking = block.thinkingText?.trim() || ''
      const stableGroupKey = block.groupId || `tg-${block.tools[0]?.id || blockKey}`
      return (
        <Fragment key={stableGroupKey}>
          <div className="timeline-message-row timeline-activity-item">
            <ToolGroupSummary
              groupId={stableGroupKey}
              tools={block.tools as unknown as ToolTimelineItem[]}
              clusterChildren={block.children}
              autoExpandedToolIds={autoExpandedToolIds}
              thinkingText={groupThinking || undefined}
              foldedAssistantTexts={block.foldedAssistantTexts}
            />
          </div>
        </Fragment>
      )
    }
    const { item, prevType } = block
    if (item.type === 'tool-call') {
      return (
        <Fragment key={item.id || blockKey}>
          <div className="timeline-message-row timeline-activity-item">
            <ToolCallRow
              item={item as unknown as ToolTimelineItem}
              autoExpandedInBudget={autoExpandedToolIds.has(item.id)}
            />
          </div>
        </Fragment>
      )
    }
    const rowEntryId = item.sessionEntryId as string | undefined
    const row = (
      <TimelineItemBase
        item={item}
        prevType={prevType}
        streaming={streamingAssistantId === item.id}
        agentRunning={agentRunning}
        agentBoot={rowAgentBoot}
        rewindEntryId={rewindEntryByItemId.get(item.id)}
        showMessageActions={showMessageActions}
        floatingMessageActions={floatingMessageActions}
        midTurnProse={midTurnProse}
        isEditing={activeEditingItemId === item.id}
        editDisabled={editDisabled}
        onStartEdit={onStartEditRow}
        onCancelEdit={handleCancelEdit}
      />
    )
    return rowEntryId ? (
      <div key={item.id || blockKey} data-session-entry-id={rowEntryId} data-item-id={item.id}>
        {row}
      </div>
    ) : (
      <div key={item.id || blockKey} data-item-id={item.id}>
        {row}
      </div>
    )
  }

  /**
   * Sibling keys must be unique: rows merged from several sources (disk pages, live cache,
   * worker reloads) can share an id, and duplicate React keys silently reorder/misplace rows
   * until a remount. Suffix repeats so each sibling list stays well-keyed.
   */
  const createKeyClaimer = () => {
    const used = new Set<string>()
    return (key: string): string => {
      if (!used.has(key)) {
        used.add(key)
        return key
      }
      let n = 1
      while (used.has(`${key}~${n}`)) n++
      const unique = `${key}~${n}`
      used.add(unique)
      return unique
    }
  }
  const claimTopKey = createKeyClaimer()

  /** Last assistant prose block id in a turn (or trailing interrupted leaf) — only that leaf gets message actions. */
  const lastProseIdInTurn = (blocks: TimelineDisplayItem[]): string | null => {
    let fallbackInterruptedId: string | null = null
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]
      if (block.kind !== 'single' || block.item.type !== 'assistant-message') continue
      if (String(block.item.text ?? '').trim()) {
        return block.item.id
      }
      if (
        !fallbackInterruptedId &&
        isInterruptedAssistantRow(
          block.item as {
            type?: string
            incomplete?: boolean
            stopReason?: string
            text?: string
            thinkingText?: string
          },
        )
      ) {
        fallbackInterruptedId = block.item.id
      }
    }
    return fallbackInterruptedId
  }

  return (
    <div ref={containerRef} data-pi-slot="timeline-viewport" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <OverlayScrollHost
      className="timeline-scroll-viewport timeline-scroll-with-dock min-h-0 flex-1 w-full"
      scrollClassName="timeline-scroll-with-dock-pane w-full"
      showRailOnHostHover
      scrollRef={scrollRef}
      onScroll={handleScroll}
    >
      <div
        ref={contentRef}
        data-pi-slot="timeline-column"
        key={historySessionFile || 'timeline'}
        className="chat-content-column py-4"
      >
      {(hiddenCount > 0 || historyLoading || fetchingOlder) && (
        <button
          type="button"
          onClick={() => loadMoreHistory()}
          disabled={historyLoading || fetchingOlder}
          className="row-hover mb-2 w-full rounded-lg py-2 text-center text-[11px] text-foreground-secondary hover:text-foreground disabled:opacity-60"
        >
          {historyLoading || fetchingOlder
            ? t('timeline:loadingOlder')
            : t('timeline:loadOlder', { count: hiddenCount })}
        </button>
      )}
      {showHonestyBanner && (
        <div
          className="mb-2 flex items-center justify-between gap-2 rounded-md border border-[color:var(--status-warn)]/25 bg-[color:var(--status-warn)]/[0.06] px-2.5 py-1.5 text-[11px] text-foreground-secondary"
          role="status"
        >
          <span className="min-w-0 flex-1">{t('timeline:honestyBanner')}</span>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-[var(--bg-hover)]"
            onClick={() => void reloadCurrentSessionData()}
            disabled={historyLoading}
          >
            {t('timeline:honestyReload')}
          </button>
        </div>
      )}
      {leading.map((block, i) => {
        const isAssistantSingle = block.kind === 'single' && block.item.type === 'assistant-message'
        const leadLastId = lastProseIdInTurn(leading)
        const isLeadLast = isAssistantSingle && block.item.id === leadLastId
        const isLeadMidProse =
          isAssistantSingle && !isLeadLast && !!String(block.item.text ?? '').trim()
        return (
          <Fragment key={claimTopKey(block.kind === 'tool-group' ? block.groupId : block.item.id || `lead-${i}`)}>
            {renderDisplayBlock(block, `lead-${i}`, {
              showMessageActions: isLeadLast || isLeadMidProse,
              floatingMessageActions: isLeadMidProse,
              midTurnProse: isLeadMidProse,
            })}
          </Fragment>
        )
      })}
      {turnGroups.map((turn, turnIndex) => {
        const isLiveTurn =
          turnIndex === turnGroups.length - 1 &&
          (!!streamingAssistantId || agentRunning || sessionChrome.phase === 'waiting_ui')
        const turnLastProseId = lastProseIdInTurn(turn.blocks)
        const claimBlockKey = createKeyClaimer()
        return (
          <div key={claimTopKey(turn.turnId)} data-pi-slot="timeline-turn" className="timeline-turn-group" data-turn-id={turn.turnId}>
            {(() => {
              const userEntryId = turn.userItem.sessionEntryId as string | undefined
              const userRow = (
                <TimelineItemBase
                  item={turn.userItem as unknown as TimelineRawItem}
                  streaming={false}
                  agentRunning={agentRunning}
                  agentBoot={false}
                  rewindEntryId={rewindEntryByItemId.get(String(turn.userItem.id))}
                  showMessageActions
                  isEditing={activeEditingItemId === turn.userItem.id}
                  editDisabled={editDisabled}
                  onStartEdit={onStartEditRow}
                  onCancelEdit={handleCancelEdit}
                />
              )
              return userEntryId ? (
                <div data-session-entry-id={userEntryId} data-item-id={turn.userItem.id}>
                  {userRow}
                </div>
              ) : (
                <div data-item-id={turn.userItem.id}>{userRow}</div>
              )
            })()}
            {turn.blocks.map((block, bi) => {
              const isAssistantSingle =
                block.kind === 'single' && block.item.type === 'assistant-message'
              const isLastProse =
                !isLiveTurn && isAssistantSingle && block.item.id === turnLastProseId
              // Mid-turn assistant prose messages also expose a zero-gap floating hover bar
              // so every persisted assistant block can be edited or copied in place.
              const isMidTurnProse =
                !isLiveTurn &&
                isAssistantSingle &&
                !isLastProse &&
                !!String(block.item.text ?? '').trim()
              const blockKey =
                block.kind === 'tool-group'
                  ? block.groupId
                  : block.kind === 'single'
                    ? block.item.id
                    : `${turn.turnId}-b${bi}`
              return (
                <Fragment key={claimBlockKey(blockKey || `${turn.turnId}-b${bi}`)}>
                  {renderDisplayBlock(block, blockKey, {
                    showMessageActions: isLastProse || isMidTurnProse,
                    floatingMessageActions: isMidTurnProse,
                    midTurnProse: isMidTurnProse,
                    allowBootPlaceholder: isLiveTurn && bi === turn.blocks.length - 1,
                  })}
                </Fragment>
              )
            })}
            {/* The live turn has nothing to show yet (its optimistic reply row is dropped when
                the view is rebuilt after a switch back): keep the waiting slot visible. */}
            {isLiveTurn && turn.blocks.length === 0 && (agentBoot || agentRunning) ? (
              <div className="timeline-message-row timeline-activity-item">
                <ReplyPlaceholder
                  startedAt={Number(turn.userItem.timestamp ?? 0) || undefined}
                  labelSeed={String(turn.turnId)}
                />
              </div>
            ) : null}
            {/* Cursor-style files card: only on the last completed turn.
                Older turns never keep a card; a new live turn hides this until done. */}
            {turnIndex === turnGroups.length - 1 && !isLiveTurn ? (
              <TurnActivityBlock blocks={turn.blocks} />
            ) : null}
          </div>
        )
      })}
      {leading.length === 0 &&
        turnGroups.length === 0 &&
        displayItems.map((block, i) => {
          const isAssistantSingle = block.kind === 'single' && block.item.type === 'assistant-message'
          const orphanLastId = lastProseIdInTurn(displayItems)
          const isOrphanLast = isAssistantSingle && block.item.id === orphanLastId
          const isOrphanMidProse =
            isAssistantSingle && !isOrphanLast && !!String(block.item.text ?? '').trim()
          return renderDisplayBlock(block, `orphan-${i}`, {
            showMessageActions: isOrphanLast || isOrphanMidProse,
            floatingMessageActions: isOrphanMidProse,
            midTurnProse: isOrphanMidProse,
            allowBootPlaceholder: isSessionTurnLive && i === displayItems.length - 1,
          })
        })}
      {/*
        Stream tail pad: while agent is live, leave blank room under the last bubble so
        new tokens grow into empty space instead of constantly shoving the viewport.
        Static sessions keep a small spacer only.
      */}
      <div
        className="timeline-stream-tail-pad shrink-0"
        style={{
          height:
            agentRunning || streamingAssistantId != null
              ? TIMELINE_STREAM_TAIL_PAD_PX
              : 16,
        }}
        aria-hidden
      />
      </div>
    </OverlayScrollHost>
    <TimelineSelectionToolbar
      containerRef={containerRef}
      contentRef={contentRef}
      scrollRef={scrollRef}
      canQuote={canQuote}
    />
    <TimelineBottomAnchorButton
      scrollRef={scrollRef}
      followLiveRef={followLiveRef}
      deps={[lastTailId, streamingTailBucket, renderCount, items.length]}
    />
    <TimelineContextMenuHost />
    </div>
  )
}
