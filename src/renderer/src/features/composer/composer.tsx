import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, Upload, Plus } from 'lucide-react'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import {
  AttachmentMeta,
  serializeRichInput,
  renderRichTextFromPlain,
  renderRichFromSegments,
  placeCaretAtEnd,
  attachmentChipKey,
  type Segment,
} from './attachments'
import { AttachmentChip } from './attachment-chip'
import { ComposerModelStrip } from './composer-model-strip'
import { ComposerMetricsInline } from './composer-metrics-inline'
import { ComposerPendingQueue } from './composer-pending-queue'
import { useComposerMetrics } from './use-composer-metrics'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useComposerInputHistory } from './use-composer-input-history'
import { RichInput, syncRichInputEmpty } from './rich-input'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { useVoiceInput } from './use-voice-input'
import { ComposerVoiceMicButton, ComposerVoiceInputOverlay } from './composer-voice-ui'
import {
  applyLiveSnapshotToView,
  fetchWorkerLiveSnapshot,
  isSessionPreviewComposeLocked,
  isViewingWorkerBoundSession,
  composerTurnActive,
} from '@renderer/lib/session-worker-sync'
import { useSessionChrome } from '@renderer/lib/session-chrome'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { insertTextAtCursor } from './composer-editor-caret'
import { makeComposerEditorAdapter } from './composer-editor-adapter'
import { useComposerSlash } from './use-composer-slash'
import { ComposerSlashPopover } from './composer-slash-popover'
import { useComposerSend } from './use-composer-send'
import { useComposerAttachments } from './use-composer-attachments'
import { useComposerKeyDown } from './use-composer-keydown'

export function Composer() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepth = useRef(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const slashPopoverAnchorRef = useRef<HTMLDivElement>(null)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const workerLiveSnapshot = useUIStore((s) => s.workerLiveSnapshot)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const pendingNew = useUIStore((s) => s.pendingNewSessionPlaceholder)
  const canCompose = !!currentWorkspace || ephemeralSandboxDraft
  const sessionPreview = useMemo(
    () =>
      !ephemeralSandboxDraft &&
      !pendingNew &&
      !!historySessionFile &&
      isSessionPreviewComposeLocked(
        historySessionFile,
        workerLiveSnapshot.sessionFile,
        workerLiveSnapshot.status,
      ),
    [
      ephemeralSandboxDraft,
      pendingNew,
      historySessionFile,
      workerLiveSnapshot.sessionFile,
      workerLiveSnapshot.status,
    ],
  )
  const canSendMessages = canCompose && !sessionPreview
  const extensionDialogOpen = useExtensionUIStore((s) => s.activePending != null)
  const sessionChrome = useSessionChrome({ extensionDialogOpen })
  const isRunning = sessionChrome.canStop || sessionChrome.showSpinner
  const showComposerStop = sessionChrome.canStop
  const model = useUIStore((s) => s.runState.model)
  const thinkingLevel = useUIStore((s) => s.runState.thinkingLevel)
  const modelPickerOpen = useUIStore((s) => s.modelPickerOpen)
  const setModelPickerOpen = useUIStore((s) => s.setModelPickerOpen)
  const thinkingPickerOpen = useUIStore((s) => s.thinkingPickerOpen)
  const setThinkingPickerOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const [composerFocused, setComposerFocused] = useState(false)
  const composerPrefill = useUIStore((s) => s.composerPrefill)
  const composerPrefillMode = useUIStore((s) => s.composerPrefillMode)
  const setComposerPrefill = useUIStore((s) => s.setComposerPrefill)
  const metrics = useComposerMetrics()
  const { voiceState, toggle: toggleVoice, disabled: voiceDisabled } = useVoiceInput(canSendMessages, (spoken) => {
    const el = editorRef.current
    if (el) insertTextAtCursor(el, spoken)
  })

  const updateFromEditor = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const { displayText, attachments: atts } = serializeRichInput(el)
    setText(displayText)
    setAttachments(atts)
  }, [])

  const setContent = useCallback(
    (plain: string) => {
      const el = editorRef.current
      if (!el) return
      renderRichTextFromPlain(el, plain)
      // Programmatic fill does not fire `input`; force placeholder hide/show.
      syncRichInputEmpty(el)
      updateFromEditor()
      placeCaretAtEnd(el)
    },
    [updateFromEditor],
  )

  const clearEditor = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    renderRichTextFromPlain(el, '')
    syncRichInputEmpty(el)
    hideAllDelayedTooltips()
    updateFromEditor()
  }, [updateFromEditor])

  const inputHistory = useComposerInputHistory(currentWorkspace, currentSessionId, setContent)

  const applySegmentsChange = useCallback(
    (next: Segment[]) => {
      const el = editorRef.current
      if (!el) return
      renderRichFromSegments(el, next)
      syncRichInputEmpty(el)
      updateFromEditor()
      placeCaretAtEnd(el)
      el.focus()
    },
    [updateFromEditor],
  )

  const currentSegments = useCallback(
    (): Segment[] => (editorRef.current ? serializeRichInput(editorRef.current).segments : []),
    [],
  )

  const slash = useComposerSlash(
    text,
    canCompose,
    currentSessionId,
    currentWorkspace,
    applySegmentsChange,
    currentSegments,
  )

  const { sendCurrent, handleSend, runComposerAbort, handleAbort } = useComposerSend({
    editorRef,
    text,
    attachments,
    updateFromEditor,
    clearEditor,
    setContent,
    inputHistory,
    refreshCommands: slash.refreshCommands,
    showComposerStop,
    isRunning,
  })

  const attachmentHandlers = useComposerAttachments({
    editorRef,
    updateFromEditor,
    canCompose,
    canSendMessages,
    currentWorkspace,
    ephemeralSandboxDraft,
    setIsDragActive,
    dragDepth,
  })

  useEffect(() => {
    if (composerPrefill == null) return
    const el = editorRef.current
    if (!el) return
    if (composerPrefillMode === 'append') {
      const current = serializeRichInput(el).displayText
      const next = current.trim()
        ? `${current.replace(/\s+$/, '')}\n${composerPrefill}`
        : composerPrefill
      setContent(next)
    } else {
      setContent(composerPrefill)
    }
    setComposerPrefill(null)
    // Focus after line-ref insert so user can keep typing
    requestAnimationFrame(() => {
      el.focus()
      placeCaretAtEnd(el)
    })
  }, [composerPrefill, composerPrefillMode, setComposerPrefill, setContent])

  useEffect(() => {
    if (!historySessionFile) return
    let cancelled = false
    let tick: number | null = null
    const pull = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const s = useUIStore.getState()
      // Drop stale polls after user switched sessions
      if (s.historySessionFile !== historySessionFile) return
      void fetchWorkerLiveSnapshot(s.currentWorkspace, historySessionFile)
        .then((snap) => {
          if (cancelled) return
          const now = useUIStore.getState()
          if (now.historySessionFile !== historySessionFile) return
          applyLiveSnapshotToView(historySessionFile, snap, now)
        })
        .catch(() => {})
    }
    const shouldPoll = () => {
      if (typeof document !== 'undefined' && document.hidden) return false
      const s = useUIStore.getState()
      if (s.historySessionFile !== historySessionFile) return false
      return composerTurnActive({
        historySessionFile: s.historySessionFile,
        workerLiveSnapshot: s.workerLiveSnapshot,
        runState: s.runState,
        streamingAssistantId: s.streamingAssistantId,
        optimisticPendingUserText: s.optimisticPendingUserText,
        sessionRuntimeRunning: s.sessionRuntimeRunning,
        agentTurnBootstrapping: s.agentTurnBootstrapping,
      })
    }
    // Initial pull only when this view might already be running (avoid racing open-session idle reset)
    if (shouldPoll()) pull()
    tick = window.setInterval(() => {
      if (!shouldPoll()) return
      pull()
    }, 2000)
    const onVisibility = () => {
      if (!document.hidden && shouldPoll()) pull()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (tick != null) window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [currentSessionId, historySessionFile])

  useEffect(() => {
    if (!canCompose) return
    if (!currentSessionId || pendingNew || ephemeralSandboxDraft) return
    void refreshComposerRunDisplay()
  }, [canCompose, currentWorkspace, currentSessionId, ephemeralSandboxDraft, pendingNew])

  const handleKeyDown = useComposerKeyDown({
    editorRef,
    text,
    attachments,
    showPopover: slash.showPopover,
    filteredCommands: slash.filteredCommands,
    selectedIdx: slash.selectedIdx,
    setSelectedIdx: slash.setSelectedIdx,
    showComposerStop,
    isRunning,
    makeAdapter: makeComposerEditorAdapter,
    inputHistory,
    setContent,
    clearEditor,
    refreshCommands: slash.refreshCommands,
    acceptCommand: slash.acceptCommand,
    dismissSlashToken: slash.dismissSlashToken,
    sendCurrent,
    handleSend,
    runComposerAbort,
  })

  return (
    <div
      data-composer-root
      className="relative min-w-0"
      onDragEnter={attachmentHandlers.handleDragEnter}
      onDragLeave={attachmentHandlers.handleDragLeave}
      onDragOver={attachmentHandlers.handleDragOver}
      onDrop={attachmentHandlers.handleDrop}
    >
      <div
        className={cn(
          'composer-drop-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-dashed border-brand/35 bg-brand/[0.06] backdrop-blur-[2px]',
          isDragActive && 'is-active',
        )}
        aria-hidden
      >
        <div className="flex flex-col items-center gap-1.5 text-primary/75">
          <Upload className="h-5 w-5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]" />
          <span className="text-[12px] font-medium">{t('composer:dropOverlay')}</span>
        </div>
      </div>
      <ComposerSlashPopover
        show={slash.showPopover}
        anchorRef={slashPopoverAnchorRef}
        text={text}
        filteredCommands={slash.filteredCommands}
        argCompletions={slash.argCompletions}
        selectedIdx={slash.selectedIdx}
        setSelectedIdx={slash.setSelectedIdx}
        argIdx={slash.argIdx}
        setArgIdx={slash.setArgIdx}
        commandsSource={slash.commandsSource}
        onAcceptCommand={slash.acceptCommand}
        onAcceptArg={slash.acceptArg}
      />
      <ComposerPendingQueue />
      {sessionPreview && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200/90">
          <span className="min-w-0 flex-1">{t('composer:previewBanner')}</span>
          {workerLiveSnapshot.status === 'running' && (
            <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 font-medium">
              {t('composer:previewBackgroundRunning')}
            </span>
          )}
        </div>
      )}
      <div
        ref={slashPopoverAnchorRef}
        className={cn(
          'composer-shell flex flex-col rounded-xl border',
          sessionPreview && 'opacity-90',
          composerFocused && 'composer-shell-focused',
          isDragActive && 'border-dashed !border-primary/50',
          voiceState === 'recording' && 'composer-shell--voice-recording',
          voiceState === 'transcribing' && 'composer-shell--voice-transcribing',
        )}
      >
        {attachments.length > 0 && (
          <div className="composer-attachments-strip flex flex-wrap gap-1.5 border-b border-border/25 px-3.5 pb-2.5 pt-2.5">
            {attachments.map((a, index) => (
              <AttachmentChip
                key={attachmentChipKey(a, index)}
                attachment={a}
                onRemove={() => attachmentHandlers.removeAttachment(a)}
              />
            ))}
          </div>
        )}
        <div className="relative flex flex-col gap-1 px-2.5 pb-2 pt-2">
          <ComposerVoiceInputOverlay
            voiceState={voiceState}
            active={
              !showComposerStop &&
              !text.trim() &&
              attachments.length === 0 &&
              (voiceState === 'recording' || voiceState === 'transcribing')
            }
          />
          <RichInput
            ref={editorRef}
            onKeyDown={handleKeyDown}
            onPaste={attachmentHandlers.handlePaste}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              inputHistory.onComposerBlur(text)
              setComposerFocused(false)
            }}
            onInput={() => {
              inputHistory.onUserEdit()
              updateFromEditor()
            }}
            placeholder={
              voiceState === 'recording' || voiceState === 'transcribing'
                ? ''
                : sessionPreview
                  ? t('composer:previewReadOnly')
                  : ephemeralSandboxDraft && !currentWorkspace
                    ? t('composer:firstMsgIsTitle')
                    : canCompose
                      ? t('composer:placeholder')
                      : t('composer:selectProjectFirst')
            }
            disabled={!canSendMessages || voiceState === 'transcribing' || voiceState === 'recording'}
          />
          <div className="composer-toolbar flex min-h-[30px] items-center gap-1.5">
            <button
              type="button"
              onClick={attachmentHandlers.pickAttachments}
              disabled={!canSendMessages}
              title={t('composer:addFile')}
              className="composer-toolbar-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary/70 disabled:opacity-30"
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
            </button>
            {canCompose && (
              <ComposerMetricsInline metrics={metrics} isRunning={showComposerStop || isRunning} />
            )}
            <div className="min-w-0 flex-1">
              {canCompose && (
                <ComposerModelStrip
                  model={model}
                  thinkingLevel={thinkingLevel}
                  modelPickerOpen={modelPickerOpen}
                  thinkingPickerOpen={thinkingPickerOpen}
                  onModelClick={() => setModelPickerOpen(true)}
                  onThinkingClick={() => setThinkingPickerOpen(true)}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showComposerStop && (
                <button
                  type="button"
                  onClick={handleAbort}
                  title={t('composer:stop')}
                  className="composer-toolbar-send flex h-8 w-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              )}
              {(() => {
                const hasContent = !!text.trim() || attachments.length > 0
                const voicePrimary = !showComposerStop && !hasContent
                if (voicePrimary) {
                  return (
                    <ComposerVoiceMicButton
                      voiceState={voiceState}
                      disabled={voiceDisabled}
                      onClick={toggleVoice}
                    />
                  )
                }
                return (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={(!text.trim() && attachments.length === 0) || !canSendMessages}
                    title={showComposerStop ? t('composer:joinQueue') : t('composer:send')}
                    className="composer-toolbar-send composer-send flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-25 disabled:pointer-events-none"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                )
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}