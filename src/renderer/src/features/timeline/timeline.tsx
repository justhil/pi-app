import { useUIStore } from '@renderer/stores/ui-store'
import type { ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCircle2, XCircle,
  CornerDownLeft, AlertCircle
} from 'lucide-react'
import { lazy, Suspense, useState, memo, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { StreamingCaret, ThinkingIndicator } from './tool-card-primitives'
import { SessionOpenLoadingView } from './session-open-loading'
import { ThinkingChainBlock } from './thinking-chain-block'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { buildTimelineDisplayItems, type TimelineDisplayItem, type TimelineRawItem } from './timeline-display-items'
import { MessageHoverActions, MessageHoverShell } from './message-hover-actions'
import { registerTimelineScrollEl } from './timeline-scroll-bridge'
import { rafThrottle } from '@renderer/lib/raf-throttle'
import { prependOlderTimelinePage } from '@renderer/lib/timeline-history-prepend'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
import { resolveRewindTargetEntryId } from '@shared/timeline-incomplete'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import {
  TIMELINE_LOAD_OLDER_SCROLL_TOP_PX,
  TIMELINE_STREAM_TAIL_PAD_PX,
  scheduleTimelineScrollToBottom,
  useTimelineLiveFollow,
} from './timeline-follow-scroll'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { useTimelineBottomAnchorController } from './timeline-bottom-anchor'
import { TimelineBottomAnchorButton } from './timeline-bottom-anchor-button'
import { splitTimelineRenderSegments, sliceHistoryForViewport } from './timeline-render-segments'
import { pickAutoExpandedToolIds } from './timeline-tool-expand-policy'
import { groupDisplayBlocksByTurn } from './timeline-turn-groups'
import { TurnActivityBlock } from './turn-activity-block'
import { enrichPlainTextWithPaths } from './markdown-inline-paths'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import { type AttachmentMeta, type Segment } from '@renderer/features/composer/attachments'

const MarkdownView = lazy(() => import('./markdown-view'))

const TimelineItemBase = memo(function TimelineItem({
  item,
  prevType,
  streaming,
  agentRunning,
  agentBoot,
  rewindEntryId,
}: {
  item: TimelineRawItem
  prevType?: string
  streaming: boolean
  agentRunning: boolean
  agentBoot: boolean
  /** Pre-resolved incomplete-assistant / user rewind target for this row */
  rewindEntryId?: string
}) {
  const { t } = useTranslation()
  const rewindTargetFor = (row: TimelineRawItem): string | undefined =>
    rewindEntryId ?? (row.sessionEntryId as string | undefined)

  if (item.type === 'user-message') {
    const segments: Segment[] = (item.segments as Segment[] | undefined)?.length
      ? (item.segments as Segment[])
      : [{ type: 'text', text: String(item.text || '') }]
    return (
      <div className={cn('timeline-message-row', prevType === 'user-message' ? 'py-1' : 'py-2.5')}>
        <MessageHoverShell
          align="right"
          actions={
            <MessageHoverActions
              text={String(item.text ?? '')}
              timestamp={Number(item.timestamp ?? 0)}
              align="right"
              sessionEntryId={rewindTargetFor(item)}
              onRewind={(id) => void navigateSessionToEntry(id)}
              onFork={(id) => void forkSessionFromEntry(id)}
            />
          }
        >
          <div
            className="max-w-[80%] px-3.5 py-2 text-[15px] leading-[1.7] text-foreground whitespace-pre-wrap break-words transition-shadow duration-300 ease-out"
            style={{
              background: 'var(--message-user-bg)',
              borderRadius: '8px 0 8px 8px',
            }}
          >
            {segments.map((s: Segment, i: number) => {
              if (s.type === 'text') return <span key={i}>{enrichPlainTextWithPaths(s.text)}</span>
              if (s.type === 'clipboard-image') {
                return (
                  <AttachmentChip
                    key={i}
                    attachment={{ path: s.path, name: s.name, kind: 'image' }}
                    openable
                    className="mx-0.5"
                  />
                )
              }
              return (
                <AttachmentChip
                  key={i}
                  attachment={s.attachment as AttachmentMeta}
                  openable
                  className="mx-0.5"
                />
              )
            })}
          </div>
        </MessageHoverShell>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    const hasText = !!String(item.text ?? '').trim()
    const hasThinking = !!String(item.thinkingText ?? '').trim()
    const sessionEntryId = item.sessionEntryId as string | undefined
    const incomplete = !!(item as { incomplete?: boolean }).incomplete
    const stopReason = String((item as { stopReason?: string }).stopReason || '')
    const isInterrupted =
      incomplete || stopReason === 'aborted' || stopReason === 'interrupted' || stopReason === 'error'
    // Empty incomplete leaf: rewind to previous user so session becomes continuable
    const resolvedRewindEntryId = rewindTargetFor(item)
    if (!hasText && !hasThinking) {
      const boot = agentBoot
      // Live placeholder while waiting for first tokens
      if (streaming || boot) {
        if (!agentRunning && !boot && !streaming) return null
        return (
          <div className="timeline-message-row py-1.5">
            <ThinkingIndicator label={boot ? t('timeline:agentStarting') : t('timeline:waitingReply')} />
          </div>
        )
      }
      // History: empty incomplete assistant after crash/force-quit — still show so user can rewind
      // Prefer incomplete flag / previous-user target even when this leaf has no entry id.
      if (sessionEntryId || isInterrupted || resolvedRewindEntryId) {
        return (
          <div className={cn('timeline-message-row', prevType === 'assistant-message' ? 'py-1.5' : 'py-2.5')}>
            <MessageHoverShell
              align="left"
              actions={
                <MessageHoverActions
                  text=""
                  timestamp={Number(item.timestamp ?? 0)}
                  align="left"
                  sessionEntryId={resolvedRewindEntryId}
                  onRewind={(id) => void navigateSessionToEntry(id)}
                />
              }
            >
              <div className="rounded-lg border border-dashed border-border/50 px-3 py-2 text-[12px] text-foreground-secondary">
                {t('timeline:interruptedEmpty', {
                  defaultValue: '回复未完成（程序关闭或中断）。可点回退到上一条后继续。',
                })}
              </div>
            </MessageHoverShell>
          </div>
        )
      }
      return null
    }
    return (
      <div className={cn('timeline-message-row', prevType === 'assistant-message' ? 'py-1.5' : 'py-2.5')}>
        <MessageHoverShell
          align="left"
          actions={
            !streaming ? (
              <MessageHoverActions
                text={String(item.text ?? '')}
                timestamp={Number(item.timestamp ?? 0)}
                align="left"
                sessionEntryId={isInterrupted && !hasText ? resolvedRewindEntryId : sessionEntryId}
                onRewind={(id) => void navigateSessionToEntry(id)}
              />
            ) : null
          }
        >
          {hasThinking && (
            <ThinkingChainBlock text={String(item.thinkingText ?? '')} streaming={streaming} />
          )}
          {hasText ? (
            <div
              className={cn(
                'min-w-0 text-[15px] leading-[1.7] text-foreground',
                streaming && 'assistant-stream-live',
              )}
            >
              <Suspense fallback={<p className="whitespace-pre-wrap break-words">{String(item.text ?? '')}</p>}>
                <MarkdownView streaming={streaming}>{String(item.text ?? '')}</MarkdownView>
              </Suspense>
              {streaming && <StreamingCaret />}
            </div>
          ) : streaming && agentRunning ? (
            <ThinkingIndicator />
          ) : isInterrupted && !hasText ? (
            <div className="text-[12px] text-foreground-secondary">
              {t('timeline:interruptedPartial', { defaultValue: '回复未完成（已中断）' })}
            </div>
          ) : null}
        </MessageHoverShell>
      </div>
    )
  }

  if (item.type === 'slash') {
    const status = item.slashStatus || 'dispatched'
    const iconCls = status === 'error' ? 'text-destructive' : status === 'ok' ? 'text-green-500' : 'text-blue-500'
    const Icon = status === 'error' ? XCircle : status === 'ok' ? CheckCircle2 : CornerDownLeft
    const label =
      status === 'error' ? t('timeline:statusFailed') : status === 'ok' ? t('timeline:statusDone') : String(item.text ?? '').includes('失败') ? t('timeline:statusFailed') : t('timeline:statusExecuted')
    return (
      <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-1 text-[11px] text-foreground-secondary" style={{ background: 'var(--bg-1)' }}>
          <Icon className={cn('h-3 w-3 shrink-0 opacity-80', iconCls)} />
          <span className="font-mono font-medium text-foreground">{String(item.slashCommand ?? '')}</span>
          <span className={cn('text-[10px] uppercase tracking-wide', iconCls)}>{label}</span>
          {String(item.text ?? '').length > 0 && (
            <span className="truncate text-foreground-secondary">{String(item.text ?? '')}</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'compaction') {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 px-2.5 py-1.5 text-foreground-secondary" style={{ background: 'var(--bg-1)' }}>
          <Archive className="h-3 w-3 opacity-70" />
          <span className="text-[11px]">{t('timeline:compacted')}</span>
          {String(item.text ?? '').length > 0 && (
            <span className="truncate text-[11px] opacity-80">{String(item.text ?? '').slice(0, 100)}...</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'error') {
    const kind = item.errorKind as string | undefined
    const isAbort = kind === 'aborted'
    // Cursor-like: soft amber for abort/errors in timeline — avoid loud destructive banners
    const borderCls = isAbort
      ? 'border-amber-500/30 bg-amber-500/[0.05]'
      : 'border-amber-500/25 bg-amber-500/[0.04]'
    const textCls = 'text-amber-900/85 dark:text-amber-100/85'
    const title = isAbort
      ? t('timeline:aborted')
      : kind === 'retry'
        ? t('timeline:retryFailed')
        : t('timeline:runError')
    return (
      <div className="py-1.5">
        <div className={cn('rounded-lg border px-3 py-2', borderCls)}>
          <div className="flex items-center gap-2">
            <AlertCircle className={cn('h-3.5 w-3.5 shrink-0 opacity-75', textCls)} />
            <span className={cn('text-[11px] font-medium', textCls)}>{title}</span>
          </div>
          {item.text != null && String(item.text) && (
            <pre
              className={cn(
                'mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed opacity-90',
                textCls,
              )}
            >
              {String(item.text)}
            </pre>
          )}
        </div>
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
  const agentRunning = useUIStore((s) =>
    composerTurnActive({
      historySessionFile: s.historySessionFile,
      workerLiveSnapshot: s.workerLiveSnapshot,
      runState: s.runState,
      streamingAssistantId: s.streamingAssistantId,
      optimisticPendingUserText: s.optimisticPendingUserText,
      sessionRuntimeRunning: s.sessionRuntimeRunning,
      agentTurnBootstrapping: s.agentTurnBootstrapping,
    }),
  )
  const agentBoot = useUIStore((s) => s.agentTurnBootstrapping)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const hasWorkspace = !!currentWorkspace || ephemeralDraft
  const isEphemeralEmpty = ephemeralDraft && !currentWorkspace
  const historyTotalCount = useUIStore((s) => s.historyTotalCount)
  const historyLoadedCount = useUIStore((s) => s.historyLoadedCount)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const historyLoading = useUIStore((s) => s.historyLoading)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const timelineMaxAutoExpandedTools = useUIStore((s) => s.timelineMaxAutoExpandedTools)
  const { t } = useTranslation()

  // Virtualization: render only a window of items, grow on scroll up
  const PAGE = 40
  const [renderCount, setRenderCount] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    const el = scrollRef.current
    registerTimelineScrollEl(el)
    if (!el) return () => registerTimelineScrollEl(null)
    const notify = rafThrottle(() => window.dispatchEvent(new Event('timeline-scroll')))
    el.addEventListener('scroll', notify, { passive: true })
    // Upward wheel detaches live-follow immediately so stream growth never fights the user.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) onUserScrollIntent(e.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    const ro = new ResizeObserver(notify)
    ro.observe(el)
    notify()
    return () => {
      registerTimelineScrollEl(null)
      el.removeEventListener('scroll', notify)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
    }
  }, [hasWorkspace, onUserScrollIntent, historySessionFile])
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)
  const renderCountRef = useRef(renderCount)
  renderCountRef.current = renderCount

  const [fetchingOlder, setFetchingOlder] = useState(false)

  const loadMoreHistory = useCallback(() => {
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

    if (canFetchDisk) {
      setFetchingOlder(true)
      scrollHeightBeforeLoadRef.current = el.scrollHeight
      const offset = st.historyLoadedCount
      const sessionFile = st.historySessionFile!
      void prependOlderTimelinePage(sessionFile, offset)
        .then(({ items: older, error }) => {
          if (error) {
            console.error('[Timeline] load older failed', error)
            scrollHeightBeforeLoadRef.current = null
            return
          }
          if (!older.length) {
            // Empty page: unlock and stop pretending more disk history exists.
            scrollHeightBeforeLoadRef.current = null
            const latest = useUIStore.getState()
            if (latest.historyLoadedCount < latest.historyTotalCount) {
              useUIStore.setState({ historyLoadedCount: latest.historyTotalCount })
            }
            return
          }
          // Expand viewport window to include prepended rows (and keep prior visible tail).
          const nextAll = useUIStore.getState().timelineItems
          const nextSegs = splitTimelineRenderSegments(nextAll, {
            streamingAssistantId: useUIStore.getState().streamingAssistantId,
            agentRunning: useUIStore.getState().runState.status === 'running',
          })
          setRenderCount((count) =>
            Math.min(Math.max(count + PAGE, count + older.length), nextSegs.history.length),
          )
        })
        .catch((error) => {
          console.error('[Timeline] load older failed', error)
          scrollHeightBeforeLoadRef.current = null
        })
        .finally(() => setFetchingOlder(false))
      return
    }

    // In-memory reveal only (already loaded items outside the render window).
    scrollHeightBeforeLoadRef.current = el.scrollHeight
    setRenderCount((count) => Math.min(count + PAGE, segs.history.length))
  }, [fetchingOlder])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const previousScrollHeight = scrollHeightBeforeLoadRef.current
    if (!el || previousScrollHeight == null) return
    scrollHeightBeforeLoadRef.current = null
    el.scrollTop = el.scrollHeight - previousScrollHeight
  }, [renderCount, items.length])

  // Reset the virtualization window only when the session file changes — not when
  // older messages are prepended (that changes items[0].id and must not reset).
  useEffect(() => {
    setRenderCount(PAGE)
    scrollHeightBeforeLoadRef.current = null
    setFetchingOlder(false)
    followLiveRef.current = true
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) scheduleTimelineScrollToBottom(el)
    })
  }, [historySessionFile, followLiveRef])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    syncFollowFromScroll()
    // Skip full segmentation unless the viewport is near the older-history threshold.
    if (el.scrollTop >= TIMELINE_LOAD_OLDER_SCROLL_TOP_PX) return
    const storeState = useUIStore.getState()
    const segs = splitTimelineRenderSegments(storeState.timelineItems, {
      streamingAssistantId: storeState.streamingAssistantId,
      agentRunning: storeState.runState.status === 'running',
    })
    const canReveal = renderCountRef.current < segs.history.length
    const canFetch = storeState.historyLoadedCount < storeState.historyTotalCount
    if (canReveal || canFetch) {
      loadMoreHistory()
    }
  }, [loadMoreHistory, syncFollowFromScroll])

  const segments = useMemo(
    () => splitTimelineRenderSegments(items, { streamingAssistantId, agentRunning }),
    [items, streamingAssistantId, agentRunning],
  )
  const visibleItems = useMemo(() => {
    const historyWindow = sliceHistoryForViewport(segments.history, renderCount)
    return [...historyWindow, ...segments.liveHead]
  }, [segments, renderCount])
  const toolExpandSlots = useMemo(
    () =>
      visibleItems
        .filter((i) => i.type === 'tool-call')
        .map((i) => {
          const toolRow = i as ToolTimelineItem
          return { id: toolRow.id, runId: toolRow.runId, toolPhase: toolRow.toolPhase }
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
  // Grouping is cheap and must see live item references (streaming text).
  const displayItems = useMemo(
    () => buildTimelineDisplayItems(visibleItems as unknown as TimelineRawItem[]),
    [visibleItems],
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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        <p className="max-w-xs text-center text-[13px] leading-relaxed text-foreground-secondary">
          {t('timeline:emptyWorkspace')}
        </p>
      </div>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-[14px] font-medium text-foreground">{t('timeline:historyIncomplete')}</p>
          <p className="max-w-sm text-[13px] text-foreground-secondary">
            {t('timeline:historyIncompleteHint', { count: historyTotalCount })}
          </p>
        </div>
      )
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center animate-in fade-in duration-[var(--motion-slow)]">
        <div className="text-[14px] font-medium text-foreground/90">
          {isEphemeralEmpty ? t('timeline:newChat') : t('timeline:placeholder')}
        </div>
        <p className="max-w-xs text-[12px] leading-relaxed text-foreground-secondary/70">
          {isEphemeralEmpty ? t('timeline:firstMessageHint') : t('timeline:emptyHint')}
        </p>
      </div>
    )
  }

  const historyWindow = sliceHistoryForViewport(segments.history, renderCount)
  const hiddenInMemory = Math.max(0, segments.history.length - historyWindow.length)
  const hiddenOnServer = Math.max(0, historyTotalCount - historyLoadedCount)
  const hiddenCount = hiddenOnServer + hiddenInMemory

  const renderDisplayBlock = (block: TimelineDisplayItem, blockKey: string, prev?: TimelineDisplayItem) => {
    const prevWasTool =
      prev?.kind === 'tool-group' || (prev?.kind === 'single' && prev.item.type === 'tool-call')
    const curIsAssistant = block.kind === 'single' && block.item.type === 'assistant-message'
    const showGroupGap = prevWasTool && curIsAssistant

    if (block.kind === 'tool-group') {
      const groupThinking = block.thinkingText?.trim() || ''
      return (
        <Fragment key={blockKey}>
          {showGroupGap && <div className="h-2" />}
          <div className="timeline-message-row space-y-0.5">
            {groupThinking ? (
              <ThinkingChainBlock text={groupThinking} streaming={false} />
            ) : null}
            {block.tools.length === 1 ? (
              <ToolCallRow
                item={block.tools[0] as unknown as ToolTimelineItem}
                autoExpandedInBudget={autoExpandedToolIds.has(block.tools[0].id)}
              />
            ) : (
              <ToolGroupSummary
                tools={block.tools as unknown as ToolTimelineItem[]}
                autoExpandedToolIds={autoExpandedToolIds}
              />
            )}
          </div>
        </Fragment>
      )
    }
    const { item, prevType } = block
    if (item.type === 'tool-call') {
      return (
        <Fragment key={blockKey}>
          <div className="timeline-message-row">
            <ToolCallRow
              item={item as unknown as ToolTimelineItem}
              autoExpandedInBudget={autoExpandedToolIds.has(item.id)}
            />
          </div>
        </Fragment>
      )
    }
    return (
      <Fragment key={blockKey}>
        {showGroupGap && <div className="h-2" />}
        <TimelineItemBase
          item={item}
          prevType={prevType}
          streaming={streamingAssistantId === item.id}
          agentRunning={agentRunning}
          agentBoot={agentBoot}
          rewindEntryId={rewindEntryByItemId.get(item.id)}
        />
      </Fragment>
    )
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <OverlayScrollHost
      className="timeline-scroll-viewport timeline-scroll-with-dock min-h-0 flex-1 w-full"
      scrollClassName="timeline-scroll-with-dock-pane w-full"
      showRailOnHostHover
      scrollRef={scrollRef}
      onScroll={handleScroll}
    >
      <div
        ref={contentRef}
        key={historySessionFile || 'timeline'}
        className="chat-content-column py-4 ui-enter"
      >
      {(hiddenCount > 0 || historyLoading) && (
        <button
          type="button"
          onClick={loadMoreHistory}
          disabled={historyLoading || fetchingOlder}
          className="row-hover mb-2 w-full rounded-lg py-2 text-center text-[11px] text-foreground-secondary hover:text-foreground disabled:opacity-60"
        >
          {historyLoading
            ? t('timeline:loadingSession')
            : t('timeline:loadOlder', { count: hiddenCount })}
        </button>
      )}
      {leading.map((block, i) => renderDisplayBlock(block, `lead-${i}`, leading[i - 1]))}
      {turnGroups.map((turn, turnIndex) => (
        <Fragment key={turn.turnId}>
          <TimelineItemBase
            item={turn.userItem as unknown as TimelineRawItem}
            streaming={false}
            agentRunning={agentRunning}
            agentBoot={agentBoot}
            rewindEntryId={rewindEntryByItemId.get(String(turn.userItem.id))}
          />
          {turn.blocks.map((block, bi) =>
            renderDisplayBlock(block, `${turn.turnId}-b${bi}`, turn.blocks[bi - 1]),
          )}
          <TurnActivityBlock
            blocks={turn.blocks}
            isStreaming={!!streamingAssistantId && turnIndex === turnGroups.length - 1}
          />
        </Fragment>
      ))}
      {leading.length === 0 &&
        turnGroups.length === 0 &&
        displayItems.map((block, i) => renderDisplayBlock(block, `orphan-${i}`, displayItems[i - 1]))}
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
    <TimelineBottomAnchorButton
      scrollRef={scrollRef}
      followLiveRef={followLiveRef}
      deps={[lastTailId, streamingTailBucket, renderCount, items.length]}
    />
    </div>
  )
}
