import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCircle2, XCircle,
  CornerDownLeft, AlertCircle
} from 'lucide-react'
import { lazy, Suspense, useState, memo, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { StreamingCaret, ThinkingIndicator } from './tool-card-primitives'
import { SessionOpenLoadingView } from './session-open-loading'
import { ThinkingChainBlock } from './thinking-chain-block'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { buildTimelineDisplayItems } from './timeline-display-items'
import { MessageHoverActions, MessageHoverShell } from './message-hover-actions'
import { registerTimelineScrollEl } from './timeline-scroll-bridge'
import { rafThrottle } from '@renderer/lib/raf-throttle'
import { fetchSessionHistoryOlder } from '@renderer/lib/session-history'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import { type AttachmentMeta, type Segment } from '@renderer/features/composer/attachments'

const MarkdownView = lazy(() => import('./markdown-view'))

const TimelineItemBase = memo(function TimelineItem({
  item,
  prevType,
  streaming,
  agentRunning,
  agentBoot,
}: {
  item: any
  prevType?: string
  streaming: boolean
  agentRunning: boolean
  agentBoot: boolean
}) {
  const { t } = useTranslation()

  if (item.type === 'user-message') {
    const segments: Segment[] = item.segments?.length ? item.segments : [{ type: 'text', text: item.text || '' }]
    return (
      <div className={cn('timeline-message-row', prevType === 'user-message' ? 'py-1' : 'py-2.5')}>
        <MessageHoverShell
          align="right"
          actions={
            <MessageHoverActions
              text={item.text}
              timestamp={item.timestamp}
              align="right"
              sessionEntryId={item.sessionEntryId}
              onRewind={(id) => void navigateSessionToEntry(id)}
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
              if (s.type === 'text') return <span key={i}>{s.text}</span>
              if (s.type === 'clipboard-image') {
                return <AttachmentChip key={i} attachment={{ path: s.path, name: s.name, kind: 'image' }} openable className="mx-0.5" />
              }
              return <AttachmentChip key={i} attachment={s.attachment as AttachmentMeta} openable className="mx-0.5" />
            })}
          </div>
        </MessageHoverShell>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    const hasText = !!(item.text && item.text.trim())
    const hasThinking = !!(item.thinkingText && item.thinkingText.trim())
    if (!hasText && !hasThinking) {
      const boot = agentBoot
      if (!streaming && !boot) return null
      if (!agentRunning && !boot) return null
      return (
        <div className="timeline-message-row py-1.5">
          <ThinkingIndicator label={boot ? t('timeline:agentStarting') : t('timeline:waitingReply')} />
        </div>
      )
    }
    return (
      <div className={cn('timeline-message-row', prevType === 'assistant-message' ? 'py-1.5' : 'py-2.5')}>
        <MessageHoverShell
          align="left"
          actions={
            !streaming ? (
              <MessageHoverActions
                text={item.text || ''}
                timestamp={item.timestamp}
                align="left"
                sessionEntryId={item.sessionEntryId}
                onRewind={(id) => void navigateSessionToEntry(id)}
              />
            ) : null
          }
        >
          {hasThinking && (
            <ThinkingChainBlock text={item.thinkingText} streaming={streaming} />
          )}
          {hasText ? (
            <div className="min-w-0 text-[15px] leading-[1.7] text-foreground">
              <Suspense fallback={<p className="whitespace-pre-wrap break-words">{item.text}</p>}>
                <MarkdownView streaming={streaming}>{item.text}</MarkdownView>
              </Suspense>
              {streaming && <StreamingCaret />}
            </div>
          ) : streaming && agentRunning ? (
            <span className="text-[12px] text-foreground-secondary/50">{t('timeline:generatingText')}</span>
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
      status === 'error' ? t('timeline:statusFailed') : status === 'ok' ? t('timeline:statusDone') : item.text?.includes('失败') ? t('timeline:statusFailed') : t('timeline:statusExecuted')
    return (
      <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-1 text-[11px] text-foreground-secondary" style={{ background: 'var(--bg-1)' }}>
          <Icon className={cn('h-3 w-3 shrink-0 opacity-80', iconCls)} />
          <span className="font-mono font-medium text-foreground">{item.slashCommand}</span>
          <span className={cn('text-[10px] uppercase tracking-wide', iconCls)}>{label}</span>
          {item.text && (
            <span className="truncate text-foreground-secondary">{item.text}</span>
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
          {item.text && (
            <span className="truncate text-[11px] opacity-80">{item.text.slice(0, 100)}...</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'error') {
    const kind = item.errorKind as string | undefined
    const isAbort = kind === 'aborted'
    const borderCls = isAbort ? 'border-amber-500/35 bg-amber-500/5' : 'border-destructive/30 bg-destructive/5'
    const textCls = isAbort ? 'text-amber-800 dark:text-amber-200' : 'text-destructive'
    const title = isAbort ? t('timeline:aborted') : kind === 'retry' ? t('timeline:retryFailed') : t('timeline:runError')
    return (
      <div className="py-1.5">
        <div className={cn('rounded-lg border px-3 py-2', borderCls)}>
          <div className="flex items-center gap-2">
            <AlertCircle className={cn('h-3.5 w-3.5 shrink-0', textCls)} />
            <span className={cn('text-[11px] font-medium', textCls)}>{title}</span>
          </div>
          {item.text && (
            <pre className={cn('mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed', textCls)}>
              {item.text}
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
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const agentBoot = useUIStore((s) => s.agentTurnBootstrapping)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const hasWorkspace = !!currentWorkspace || ephemeralDraft
  const isEphemeralEmpty = ephemeralDraft && !currentWorkspace
  const historyTotalCount = useUIStore((s) => s.historyTotalCount)
  const historyLoadedCount = useUIStore((s) => s.historyLoadedCount)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const historyLoading = useUIStore((s) => s.historyLoading)
  const prependHistoryItems = useUIStore((s) => s.prependHistoryItems)
  const { t } = useTranslation()

  // Virtualization: render only a window of items, grow on scroll up
  const PAGE = 40
  const [renderCount, setRenderCount] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    registerTimelineScrollEl(el)
    if (!el) return () => registerTimelineScrollEl(null)
    const notify = rafThrottle(() => window.dispatchEvent(new Event('timeline-scroll')))
    el.addEventListener('scroll', notify, { passive: true })
    const ro = new ResizeObserver(notify)
    ro.observe(el)
    notify()
    return () => {
      registerTimelineScrollEl(null)
      el.removeEventListener('scroll', notify)
      ro.disconnect()
    }
  }, [items.length, renderCount, hasWorkspace])
  const wasNearBottomRef = useRef(true)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)
  const renderCountRef = useRef(renderCount)
  renderCountRef.current = renderCount
  const itemsLengthRef = useRef(items.length)
  itemsLengthRef.current = items.length

  const [fetchingOlder, setFetchingOlder] = useState(false)

  const loadMoreHistory = useCallback(() => {
    const el = scrollRef.current
    const total = itemsLengthRef.current
    const current = renderCountRef.current
    if (!el || scrollHeightBeforeLoadRef.current != null) return

    const st = useUIStore.getState()
    if (
      st.historySessionFile &&
      st.historyLoadedCount < st.historyTotalCount &&
      !fetchingOlder
    ) {
      setFetchingOlder(true)
      scrollHeightBeforeLoadRef.current = el.scrollHeight
      const offset = st.historyLoadedCount
      void fetchSessionHistoryOlder(st.historySessionFile, offset)
        .then(({ items: older }) => {
          if (older.length) prependHistoryItems(older as any[])
          setRenderCount((c) => Math.min(c + PAGE, useUIStore.getState().timelineItems.length))
        })
        .catch((e) => console.error('[Timeline] load older failed', e))
        .finally(() => setFetchingOlder(false))
      return
    }

    if (current >= total) return
    scrollHeightBeforeLoadRef.current = el.scrollHeight
    setRenderCount((c) => Math.min(c + PAGE, total))
  }, [prependHistoryItems, fetchingOlder])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const prevH = scrollHeightBeforeLoadRef.current
    if (!el || prevH == null) return
    scrollHeightBeforeLoadRef.current = null
    el.scrollTop = el.scrollHeight - prevH
  }, [renderCount])

  // Reset window when session changes (item list replaced)
  const firstId = items[0]?.id
  useEffect(() => {
    setRenderCount(PAGE)
    scrollHeightBeforeLoadRef.current = null
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [firstId])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop < 160 && renderCountRef.current < itemsLengthRef.current) {
      loadMoreHistory()
    }
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [loadMoreHistory])

  // Auto-scroll to bottom when new items arrive (only if user was already near bottom)
  const lastId = items[items.length - 1]?.id
  useEffect(() => {
    if (wasNearBottomRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    }
  }, [lastId])

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
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center animate-in fade-in duration-[var(--motion-slow)]">
        <div className="text-[15px] font-medium text-foreground">
          {isEphemeralEmpty ? t('timeline:newChat') : t('timeline:placeholder')}
        </div>
        <p className="max-w-sm text-[13px] leading-relaxed text-foreground-secondary">
          {isEphemeralEmpty
            ? t('timeline:firstMessageHint')
            : (
              <>
                {t('timeline:emptyHint')}
              </>
            )}
        </p>
        {!isEphemeralEmpty && (
          <p className="text-[12px] text-foreground-secondary/80">{t('timeline:sidebarHint')}</p>
        )}
      </div>
    )
  }

  const visible = items.slice(Math.max(0, items.length - renderCount))
  const hiddenInMemory = items.length - visible.length
  const hiddenOnServer = Math.max(0, historyTotalCount - historyLoadedCount)
  const hiddenCount = hiddenOnServer + hiddenInMemory
  const displayItems = buildTimelineDisplayItems(visible as any[])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <OverlayScrollHost
      className="timeline-scroll-viewport timeline-scroll-with-dock min-h-0 flex-1 w-full"
      scrollClassName="timeline-scroll-with-dock-pane w-full"
      showRailOnHostHover
      scrollRef={scrollRef}
      onScroll={handleScroll}
    >
      <div
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
            : `${t('timeline:loadOlder')}（${hiddenCount}）`}
        </button>
      )}
      {displayItems.map((block, i) => {
        const prev = displayItems[i - 1]
        const prevWasTool =
          prev?.kind === 'tool-group' ||
          (prev?.kind === 'single' && prev.item.type === 'tool-call')
        const curIsAssistant = block.kind === 'single' && block.item.type === 'assistant-message'
        const showGroupGap = prevWasTool && curIsAssistant

        if (block.kind === 'tool-group') {
          return (
            <Fragment key={block.groupId}>
              {showGroupGap && <div className="h-2" />}
              <div className="timeline-message-row">
                <ToolGroupSummary tools={block.tools} />
              </div>
            </Fragment>
          )
        }

        const { item, prevType } = block
        if (item.type === 'tool-call') {
          return (
            <Fragment key={item.id}>
              <div className="timeline-message-row">
                <ToolCallRow item={item} />
              </div>
            </Fragment>
          )
        }

        return (
          <Fragment key={item.id}>
            {showGroupGap && <div className="h-2" />}
            <TimelineItemBase
              item={item}
              prevType={prevType}
              streaming={streamingAssistantId === item.id}
              agentRunning={agentRunning}
              agentBoot={agentBoot}
            />
          </Fragment>
        )
      })}
      <div className="h-4" />
      </div>
    </OverlayScrollHost>
    </div>
  )
}
