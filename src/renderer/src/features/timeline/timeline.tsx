import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem, ToolTimelineItem } from '@renderer/stores/ui-store-types'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCircle2, XCircle,
  CornerDownLeft, AlertCircle
} from '@renderer/components/icons'
import { lazy, Suspense, useState, memo, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { StreamingCaret } from './tool-card-primitives'
import { SessionOpenLoadingView } from './session-open-loading'
import { ThinkingChainBlock } from './thinking-chain-block'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { SkillInvocationRow, isSkillInvocationMessage } from './skill-invocation-row'
import { buildTimelineDisplayItems, type TimelineDisplayItem, type TimelineRawItem } from './timeline-display-items'
import { MessageHoverActions, MessageHoverShell } from './message-hover-actions'
import { registerTimelineScrollEl } from './timeline-scroll-bridge'
import { rafThrottle } from '@renderer/lib/raf-throttle'
import { prependOlderTimelinePage } from '@renderer/lib/timeline-history-prepend'
import { fetchSessionHistoryOlder, fetchSessionHistoryTail } from '@renderer/lib/session-history'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
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
import { useTimelineBottomAnchorController } from './timeline-bottom-anchor'
import { TimelineBottomAnchorButton } from './timeline-bottom-anchor-button'
import { splitTimelineRenderSegments, sliceHistoryForViewport } from './timeline-render-segments'
import { pickAutoExpandedActivityIds } from './timeline-tool-expand-policy'
import { groupDisplayBlocksByTurn } from './timeline-turn-groups'
import { TurnActivityBlock } from './turn-activity-block'
import { shouldShowTimelineHonestyBanner } from '@renderer/lib/timeline-honesty'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'
import { EmptyState } from '@renderer/components/ui/empty-state'
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
  /** 滑动窗口：该行是否被窗口自动展开（思考块用） */
  autoExpanded = false,
  /** Only the last prose leaf of a turn (or user) should expose copy/rewind chrome. */
  showMessageActions = true,
}: {
  item: TimelineRawItem
  prevType?: string
  streaming: boolean
  agentRunning: boolean
  agentBoot: boolean
  /** Pre-resolved incomplete-assistant / user rewind target for this row */
  rewindEntryId?: string
  autoExpanded?: boolean
  showMessageActions?: boolean
}) {
  const { t } = useTranslation()
  const rewindTargetFor = (row: TimelineRawItem): string | undefined =>
    rewindEntryId ?? (row.sessionEntryId as string | undefined)

  if (item.type === 'user-message') {
    // skill 调用：pi 把 skill 内容作为独立用户消息注入，折叠为一行摘要（默认折叠、不受窗口限制）
    if (isSkillInvocationMessage(String(item.text || ''))) {
      return (
        <div className="timeline-message-row timeline-activity-item">
          <SkillInvocationRow item={item as unknown as TimelineItem} />
        </div>
      )
    }
    const segments: Segment[] = (item.segments as Segment[] | undefined)?.length
      ? (item.segments as Segment[])
      : [{ type: 'text', text: String(item.text || '') }]
    return (
      <div className="timeline-message-row timeline-user-row">
        <MessageHoverShell
          align="right"
          actions={
            showMessageActions ? (
              <MessageHoverActions
                text={String(item.text ?? '')}
                timestamp={Number(item.timestamp ?? 0)}
                align="right"
                sessionEntryId={rewindTargetFor(item)}
                onRewind={(id) => void navigateSessionToEntry(id)}
                onFork={(id) => void forkSessionFromEntry(id)}
              />
            ) : null
          }
        >
          <div className="timeline-user-bubble">
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
    const isInterrupted = isInterruptedAssistantRow(item as { type?: string; incomplete?: boolean; stopReason?: string; text?: string; thinkingText?: string })
    // Empty incomplete leaf: rewind to previous user so session becomes continuable
    const resolvedRewindEntryId = rewindTargetFor(item)
    // Activity-density row: thinking-only (no prose) — no 32px hover slot, no message padding
    const isActivityThinkingOnly = hasThinking && !hasText && !isInterrupted
    // Mid-turn bridge prose is part of the same reply — no per-segment message chrome.
    const allowMessageActions = showMessageActions && !streaming

    if (!hasText && !hasThinking) {
      // Optimistic / live wait: show thinking placeholder (not empty silence).
      if (streaming || agentBoot) {
        return (
          <div className="timeline-message-row timeline-activity-item">
            <ThinkingChainBlock
              text=""
              streaming
              placeholder
              startedAt={Number(item.timestamp ?? 0) || undefined}
              labelSeed={String(item.id)}
            />
          </div>
        )
      }
      // Only show interrupted chrome for true incomplete leaves — not mid-turn tool bridges.
      if (isInterrupted) {
        return (
          <div className="timeline-message-row timeline-prose-row">
            <MessageHoverShell
              align="left"
              actions={
                allowMessageActions ? (
                  <MessageHoverActions
                    text=""
                    timestamp={Number(item.timestamp ?? 0)}
                    align="left"
                    sessionEntryId={resolvedRewindEntryId}
                    onRewind={(id) => void navigateSessionToEntry(id)}
                  />
                ) : null
              }
            >
              <div className="timeline-status-line timeline-status-line--warn text-[12px]">
                {t('timeline:interruptedEmpty', {
                  defaultValue: '回复未完成（程序关闭或中断）。可点回退到上一条后继续。',
                })}
              </div>
            </MessageHoverShell>
          </div>
        )
      }
      // Empty tool-bridge residue (should usually be absorbed by display clustering)
      return null
    }

    if (isActivityThinkingOnly) {
      return (
        <div className="timeline-message-row timeline-activity-item">
          <ThinkingChainBlock
            text={String(item.thinkingText ?? '')}
            streaming={streaming}
            autoExpanded={autoExpanded}
            startedAt={Number(item.timestamp ?? 0) || undefined}
            duration={Number(item.thinkingDuration ?? 0) || undefined}
            labelSeed={String(item.id)}
          />
        </div>
      )
    }

    const proseBody = (
      <>
        {hasThinking && (
          <ThinkingChainBlock
            text={String(item.thinkingText ?? '')}
            streaming={streaming}
            autoExpanded={autoExpanded}
            startedAt={Number(item.timestamp ?? 0) || undefined}
            duration={Number(item.thinkingDuration ?? 0) || undefined}
            labelSeed={String(item.id)}
          />
        )}
        {hasText ? (
          <div
            className={cn(
              'min-w-0 text-[15px] leading-[1.65] timeline-text-body',
              streaming && 'assistant-stream-live',
            )}
          >
            <Suspense fallback={<p className="whitespace-pre-wrap break-words">{String(item.text ?? '')}</p>}>
              <MarkdownView streaming={streaming}>{String(item.text ?? '')}</MarkdownView>
            </Suspense>
            {streaming && <StreamingCaret />}
          </div>
        ) : isInterrupted && !hasText ? (
          <div className="text-[12px] timeline-text-quiet">
            {t('timeline:interruptedPartial', { defaultValue: '回复未完成（已中断）' })}
          </div>
        ) : null}
      </>
    )

    return (
      <div className="timeline-message-row timeline-prose-row">
        {allowMessageActions ? (
          <MessageHoverShell
            align="left"
            actions={
              <MessageHoverActions
                text={String(item.text ?? '')}
                timestamp={Number(item.timestamp ?? 0)}
                align="left"
                sessionEntryId={isInterrupted && !hasText ? resolvedRewindEntryId : sessionEntryId}
                onRewind={(id) => void navigateSessionToEntry(id)}
              />
            }
          >
            {proseBody}
          </MessageHoverShell>
        ) : (
          proseBody
        )}
      </div>
    )
  }

  if (item.type === 'slash') {
    const status = item.slashStatus || 'dispatched'
    const iconCls =
      status === 'error'
        ? 'text-destructive/70'
        : status === 'ok'
          ? 'text-emerald-600/70 dark:text-emerald-400/70'
          : 'timeline-text-quiet'
    const Icon = status === 'error' ? XCircle : status === 'ok' ? CheckCircle2 : CornerDownLeft
    const label =
      status === 'error' ? t('timeline:statusFailed') : status === 'ok' ? t('timeline:statusDone') : String(item.text ?? '').includes('失败') ? t('timeline:statusFailed') : t('timeline:statusExecuted')
    return (
      <div className="py-1">
        <div className="timeline-status-line">
          <Icon className={cn('h-3 w-3 shrink-0', iconCls)} />
          <span className="font-mono text-[12px] timeline-text-secondary">{String(item.slashCommand ?? '')}</span>
          <span className={cn('text-[11px]', iconCls)}>{label}</span>
          {String(item.text ?? '').length > 0 && (
            <span className="truncate timeline-text-quiet">{String(item.text ?? '')}</span>
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

  if (item.type === 'model-change') {
    const meta = item as unknown as TimelineItem & { model?: string; thinkingLevel?: string }
    const parts: string[] = []
    if (meta.model) parts.push(t('timeline:modelChangeTo', { model: meta.model }))
    if (meta.thinkingLevel) {
      parts.push(t('timeline:thinkingLevelChangeTo', { level: meta.thinkingLevel }))
    }
    if (parts.length === 0) return null
    return (
      <div className="timeline-message-row timeline-activity-item">
        <div className="flex items-center gap-1.5 px-0.5 text-[11px] timeline-text-quiet">
          <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
          <span>{parts.join(' · ')}</span>
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
  const historyLoading = useUIStore((s) => s.historyLoading)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const timelineMaxAutoExpandedTools = useUIStore((s) => s.timelineMaxAutoExpandedTools)
  const { t } = useTranslation()

  // Virtualization: render only a window of items, grow on scroll up
  const PAGE = 40
  const [renderCount, setRenderCount] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // ---- Non-destructive view jumps from the session tree (click = view, dblclick = rewind) ----
  const viewSeqRef = useRef(0)
  const viewLoadRef = useRef<Promise<void> | null>(null)
  const viewTailSnapshotRef = useRef<{ id?: string; type?: string } | null>(null)
  const viewLandedRef = useRef<{ entryId: string; seq: number } | null>(null)
  const [viewTarget, setViewTarget] = useState<string | null>(null)
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
    if (plan.kind === 'scroll') {
      setRenderCount((count) => Math.max(count, plan.requiredRenderCount))
      return
    }
    if (plan.kind === 'load') {
      if (viewLoadRef.current) return
      const sessionFile = st.historySessionFile
      if (!sessionFile) return
      const captured = viewTailSnapshotRef.current
      const tail = all.at(-1) ?? null
      viewLoadRef.current = (async () => {
        const res = await fetchSessionHistoryTail(sessionFile, VIEW_REVEAL_CHUNK_LIMIT, {
          leafId: plan.entryId,
          bypassCache: true,
        })
        if (seq !== viewSeqRef.current) return
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
          // One leaf-anchored call reaches back at most 500 items (handler clamp).
          const gapFetched = Math.min(gap, 500)
          const tailRes = await fetchSessionHistoryTail(sessionFile, gapFetched, { leafId: null })
          if (seq !== viewSeqRef.current) return
          if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
          allFetched = [...chunk, ...((tailRes.items || []) as TimelineItem[])]
          // When the target is further than 500 items below the loaded tail, the
          // gap fetch leaves a hole between the target and the tail. Close it with
          // one offset-based page spanning exactly the middle.
          const gapTailStart = total - gapFetched + 1
          const middleLength = gapTailStart - 1 - targetPos
          if (middleLength > 0) {
            const middleRes = await fetchSessionHistoryOlder(
              sessionFile,
              gapFetched,
              Math.min(middleLength, 500),
            )
            if (seq !== viewSeqRef.current) return
            if (userSentSince(captured, useUIStore.getState().timelineItems.at(-1) ?? null)) return
            // Oldest-first: target chunk, then the middle, then the tail remainder.
            allFetched = [
              ...chunk,
              ...((middleRes.items || []) as TimelineItem[]),
              ...((tailRes.items || []) as TimelineItem[]),
            ]
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
            const chunkLen = Math.min(VIEW_REVEAL_CHUNK_LIMIT, targetPos)
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
          viewLoadRef.current = null
        })
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

  useEffect(() => {
    const el = scrollRef.current
    registerTimelineScrollEl(el)
    if (!el) return () => registerTimelineScrollEl(null)
    const notify = rafThrottle(() => window.dispatchEvent(new Event('timeline-scroll')))
    el.addEventListener('scroll', notify, { passive: true })
    // Upward wheel detaches live-follow immediately so stream growth never fights the user.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        onUserScrollIntent(e.deltaY)
        // A pending view jump yields to the user's own scroll.
        viewSeqRef.current += 1
        viewLandedRef.current = null
      }
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
  const scrollHeightBeforeLoadRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
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
      scrollHeightBeforeLoadRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
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
    scrollHeightBeforeLoadRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    setRenderCount((count) => Math.min(count + PAGE, segs.history.length))
  }, [fetchingOlder])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const previous = scrollHeightBeforeLoadRef.current
    if (!el || previous == null) return
    scrollHeightBeforeLoadRef.current = null
    // Anchor the viewport's content (not the bottom): when older rows are
    // prepended / the render window grows, keep the same content at the top of
    // the viewport. A bottom-anchored formula (scrollHeight - prevHeight) yanked
    // the view toward the leaf right after a view-jump landed on an old node.
    const growth = el.scrollHeight - previous.scrollHeight
    el.scrollTop = previous.scrollTop + growth
  }, [renderCount, items.length])

  // Reset the virtualization window only when the session file changes — not when
  // older messages are prepended (that changes items[0].id and must not reset).
  const prevSessionFileRef = useRef<string | null>(null)
  useEffect(() => {
    setRenderCount(PAGE)
    scrollHeightBeforeLoadRef.current = null
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
        .filter(
          (row) =>
            row.type === 'tool-call' ||
            (row.type === 'assistant-message' &&
              !!String((row as { thinkingText?: string }).thinkingText ?? '').trim()),
        )
        .map((row) => {
          const toolRow = row as ToolTimelineItem
          return {
            id: toolRow.id,
            kind: row.type === 'assistant-message' ? ('thinking' as const) : ('tool' as const),
          }
        }),
    [visibleItems],
  )
  const autoExpandedToolIds = useMemo(
    () =>
      pickAutoExpandedActivityIds(toolExpandSlots, {
        maxExpanded: timelineMaxAutoExpandedTools,
      }),
    [toolExpandSlots, timelineMaxAutoExpandedTools],
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
    opts?: { showMessageActions?: boolean },
  ) => {
    const showMessageActions = opts?.showMessageActions !== false
    if (block.kind === 'tool-group') {
      const groupThinking = block.thinkingText?.trim() || ''
      const stableGroupKey = block.groupId || `tg-${block.tools[0]?.id || blockKey}`
      return (
        <Fragment key={stableGroupKey}>
          <div className="timeline-message-row timeline-activity-item">
            <ToolGroupSummary
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
        agentBoot={agentBoot}
        autoExpanded={autoExpandedToolIds.has(item.id)}
        rewindEntryId={rewindEntryByItemId.get(item.id)}
        showMessageActions={showMessageActions}
      />
    )
    return rowEntryId ? (
      <div key={item.id || blockKey} data-session-entry-id={rowEntryId}>
        {row}
      </div>
    ) : (
      <Fragment key={item.id || blockKey}>{row}</Fragment>
    )
  }

  /** Last assistant prose block id in a turn — only that leaf gets message actions. */
  const lastProseIdInTurn = (blocks: TimelineDisplayItem[]): string | null => {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]
      if (
        block.kind === 'single' &&
        block.item.type === 'assistant-message' &&
        !!String(block.item.text ?? '').trim()
      ) {
        return block.item.id
      }
    }
    return null
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
        className="chat-content-column py-4"
      >
      {(hiddenCount > 0 || historyLoading || fetchingOlder) && (
        <button
          type="button"
          onClick={loadMoreHistory}
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
      {leading.map((block, i) =>
        renderDisplayBlock(block, `lead-${i}`, {
          showMessageActions:
            block.kind === 'single' &&
            block.item.type === 'assistant-message' &&
            block.item.id === lastProseIdInTurn(leading),
        }),
      )}
      {turnGroups.map((turn, turnIndex) => {
        const isLiveTurn =
          turnIndex === turnGroups.length - 1 &&
          (!!streamingAssistantId || agentRunning || sessionChrome.phase === 'waiting_ui')
        const turnLastProseId = lastProseIdInTurn(turn.blocks)
        return (
          <Fragment key={turn.turnId}>
            {(() => {
              const userEntryId = turn.userItem.sessionEntryId as string | undefined
              const userRow = (
                <TimelineItemBase
                  item={turn.userItem as unknown as TimelineRawItem}
                  streaming={false}
                  agentRunning={agentRunning}
                  agentBoot={agentBoot}
                  rewindEntryId={rewindEntryByItemId.get(String(turn.userItem.id))}
                  showMessageActions
                />
              )
              return userEntryId ? (
                <div data-session-entry-id={userEntryId}>{userRow}</div>
              ) : (
                userRow
              )
            })()}
            {turn.blocks.map((block, bi) => {
              // One reply = one message chrome: only the final prose leaf after the turn settles.
              const isLastProse =
                !isLiveTurn &&
                block.kind === 'single' &&
                block.item.type === 'assistant-message' &&
                block.item.id === turnLastProseId
              return renderDisplayBlock(
                block,
                block.kind === 'tool-group'
                  ? block.groupId
                  : block.kind === 'single'
                    ? block.item.id
                    : `${turn.turnId}-b${bi}`,
                { showMessageActions: isLastProse },
              )
            })}
            {/* Cursor-style files card: only on the last completed turn.
                Older turns never keep a card; a new live turn hides this until done. */}
            {turnIndex === turnGroups.length - 1 && !isLiveTurn ? (
              <TurnActivityBlock blocks={turn.blocks} />
            ) : null}
          </Fragment>
        )
      })}
      {leading.length === 0 &&
        turnGroups.length === 0 &&
        displayItems.map((block, i) =>
          renderDisplayBlock(block, `orphan-${i}`, {
            showMessageActions:
              block.kind === 'single' &&
              block.item.type === 'assistant-message' &&
              block.item.id === lastProseIdInTurn(displayItems),
          }),
        )}
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
