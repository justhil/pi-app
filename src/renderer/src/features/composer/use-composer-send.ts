import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { renderRichFromSegments, serializeRichInput, type AttachmentMeta, type Segment, type StagedImage } from './attachments'
import { segmentsToPromptPayload } from './attachment-text'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { clearAbortQueueIgnore, clearAbortUiHold } from '@renderer/lib/abort-ui-hold'
import { extensionUiBlocksComposer, useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import type { useComposerInputHistory } from './use-composer-input-history'
import {
  commitPurgedSessionAfterSend,
  consumeDraftPurgeForFirstSend,
  rollbackDraftPurgeAfterSendFailure,
} from '@renderer/lib/agent-purge-store'
import { currentSessionCapabilities } from '@renderer/lib/session-capabilities'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  composerDraftContextKey,
  readTransientComposerDraft,
  readTransientComposerImages,
  rememberTransientComposerDraft,
  rememberTransientComposerImages,
} from './composer-transient-draft'

export function useComposerSend(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  text: string
  attachments: { path: string }[]
  /** 已暂存、未发送的图片（不在编辑器里）。 */
  stagedImages: StagedImage[]
  setStagedImages: React.Dispatch<React.SetStateAction<StagedImage[]>>
  updateFromEditor: () => void
  clearEditor: () => void
  setContent: (plain: string) => void
  inputHistory: ReturnType<typeof useComposerInputHistory>
  refreshCommands: () => Promise<void>
  showComposerStop: boolean
  isRunning: boolean
}) {
  const { t } = useTranslation()
  const sendingRef = useRef(false)
  const sendGenRef = useRef(0)
  const cancelledSendGenRef = useRef(0)
  const activeSendContextRef = useRef<{
    gen: number
    draftKey: string
    sessionFile?: string
    optimisticToken: { sessionFile: string | null; assistantId: string; userId: string } | null
    agentPurge?: ReturnType<typeof consumeDraftPurgeForFirstSend>
  } | null>(null)
  const {
    editorRef,
    text,
    stagedImages,
    setStagedImages,
    updateFromEditor,
    clearEditor,
    setContent,
    inputHistory,
    refreshCommands,
    showComposerStop,
    isRunning,
  } = opts

  useEffect(() => {
    const cancelInFlightForSession = (targetSessionFile: string | null | undefined) => {
      const ctx = activeSendContextRef.current
      if (!ctx) return
      const matchesTarget =
        !targetSessionFile ||
        !ctx.sessionFile ||
        sessionFilesEqual(ctx.sessionFile, targetSessionFile) ||
        sessionFilesEqual(ctx.optimisticToken?.sessionFile, targetSessionFile)
      if (!matchesTarget) return
      cancelledSendGenRef.current = Math.max(cancelledSendGenRef.current, ctx.gen)
      sendingRef.current = false
    }
    const onAbortEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionFile?: string | null }>).detail
      cancelInFlightForSession(detail?.sessionFile)
    }
    window.addEventListener('pi-desktop:cancel-pending-send', onAbortEvent)
    return () => window.removeEventListener('pi-desktop:cancel-pending-send', onAbortEvent)
  }, [])

  const sendCurrent = useCallback(
    async (queueOpts?: { queue?: 'steer' | 'followUp' }) => {
      if (sendingRef.current) return
      sendingRef.current = true
      const sendGen = ++sendGenRef.current
      const isCancelled = () => cancelledSendGenRef.current >= sendGen
      // Snapshot the switches the user sees now: sending a new chat creates its session file
      // before the prompt goes out, and the draft's switches move to it.
      const capabilities = currentSessionCapabilities()
      let sendCtx: NonNullable<typeof activeSendContextRef.current> | null = null
      try {
        if (extensionUiBlocksComposer()) {
          toast.message(t('composer:toast.completeExtensionFirst'))
          return
        }
        const el = editorRef.current
        if (!el) return
        const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
        const inlinePaths = new Set(atts.map((a) => a.path))
        const extraStaged = stagedImages.filter((img) => !inlinePaths.has(img.path))
        const stagedSegments: Segment[] = extraStaged.map((img) => ({
          type: 'file',
          attachment: { path: img.path, name: img.name, kind: 'image' },
        }))
        const allSegments = stagedSegments.length ? [...segments, ...stagedSegments] : segments
        const allAtts: AttachmentMeta[] = stagedSegments.length
          ? [...atts, ...stagedSegments.map((s) => (s as { attachment: AttachmentMeta }).attachment)]
          : atts
        const promptText = stagedSegments.length ? segmentsToPromptPayload(allSegments) : payload
        const stagedSnapshot = stagedImages
        const trimmed = displayText.trim()
        if (!trimmed && allAtts.length === 0) return
        const store = useUIStore.getState()
        const creationOrigin = { state: store, navigationToken: getSessionNavigationToken() }
        const ownsSourceView = () => {
          const current = useUIStore.getState()
          return isSessionNavigationCurrent(creationOrigin.navigationToken) &&
            current.currentWorkspace === store.currentWorkspace &&
            current.currentSessionId === store.currentSessionId &&
            current.historySessionFile === store.historySessionFile
        }
        if (allAtts.length === 0 && isExecutableBuiltin(trimmed)) {
          clearEditor()
          await executeSlashCommand(trimmed, { refreshCommands })
          return
        }
        if (trimmed.startsWith('/')) {
          const routed = await routeDesktopSlashBeforeSend(trimmed)
          if (routed.handled) {
            clearEditor()
            return
          }
          if (isCancelled()) return
        }
        const draft = store.ephemeralSandboxDraft
        const currentWorkspace = store.currentWorkspace
        if (!currentWorkspace && !draft) return
        let sessionFile = store.historySessionFile ?? undefined
        if (sessionFile) {
          // A fresh prompt lifts any previous abort-hold mask immediately on this session
          // so its own run events and Stop button are never dropped.
          clearAbortUiHold(sessionFile)
          clearAbortQueueIgnore(sessionFile)
        }
        const { composerTurnActive } = await import('@renderer/lib/session-worker-sync')
        if (isCancelled()) return
        const running = composerTurnActive({
          historySessionFile: store.historySessionFile,
          workerLiveSnapshot: store.workerLiveSnapshot,
          sessionRuntimeRunning: store.sessionRuntimeRunning,
        })
        if (displayText.trim()) inputHistory.recordSent(displayText.trim())
        const { hideAllDelayedTooltips } = await import('./delayed-tooltip')
        hideAllDelayedTooltips()
        const { renderRichTextFromPlain } = await import('./attachments')
        renderRichTextFromPlain(el, '')
        setStagedImages([])
        updateFromEditor()
        editorRef.current?.focus()
        const pendingNew = store.pendingNewSessionPlaceholder
        const homeMode = !store.currentSessionId && store.timelineItems.length === 0
        const isFirstTurnOfNewChat = !running && (draft || pendingNew || homeMode) && !store.historySessionFile
        const agentPurge = consumeDraftPurgeForFirstSend(isFirstTurnOfNewChat)
        const { appendOptimisticOutgoingMessage, bindOptimisticOutgoingToSession, clearOptimisticOutgoing } =
          await import('@renderer/lib/optimistic-send')
        let optimisticToken: ReturnType<typeof appendOptimisticOutgoingMessage> = null
        let draftKey = composerDraftContextKey(store)
        rememberTransientComposerImages(draftKey, [])
        sendCtx = { gen: sendGen, draftKey, sessionFile, optimisticToken: null, agentPurge }
        activeSendContextRef.current = sendCtx
        const promptPayload = () => ({
          sessionId: '',
          sessionFile,
          text: promptText,
          capabilities,
          ...(agentPurge ? { agentPurge } : {}),
        })
        let promptAccepted = false
        const restoreUnsentDraft = (silent = false) => {
          rollbackDraftPurgeAfterSendFailure(agentPurge)
          if (clearOptimisticOutgoing(optimisticToken)) {
            useUIStore.getState().setRunState({ status: 'idle' })
          }
          const ownsEditor = editorRef.current === el &&
            draftKey === composerDraftContextKey(useUIStore.getState())
          const currentDraft = ownsEditor
            ? serializeRichInput(el).segments
            : readTransientComposerDraft(draftKey) ?? []
          const restored = [...segments]
          if (currentDraft.length) restored.push({ type: 'text', text: '\n' }, ...currentDraft)
          rememberTransientComposerDraft(draftKey, restored)
          if (stagedSnapshot.length > 0) {
            if (ownsEditor) {
              setStagedImages((prev) => {
                const merged = [
                  ...stagedSnapshot,
                  ...prev.filter((item) => !stagedSnapshot.some((s) => s.path === item.path)),
                ]
                rememberTransientComposerImages(draftKey, merged)
                return merged
              })
            } else {
              const existing = readTransientComposerImages(draftKey) ?? []
              const merged = [
                ...stagedSnapshot,
                ...existing.filter((item) => !stagedSnapshot.some((s) => s.path === item.path)),
              ]
              rememberTransientComposerImages(draftKey, merged)
            }
          }
          if (ownsEditor) {
            renderRichFromSegments(el, restored)
            updateFromEditor()
          }
          if (!silent) toast.error(t('composer:toast.sendFailed'))
        }
        const sendPrompt = async () => {
          if (isCancelled()) {
            restoreUnsentDraft(true)
            return null
          }
          const bind = await ipcClient.invoke('prompt.send', promptPayload())
          if ((bind as { cancelledBeforeSend?: boolean } | undefined)?.cancelledBeforeSend) {
            restoreUnsentDraft(true)
            return null
          }
          promptAccepted = true
          if (agentPurge?.enabled) {
            commitPurgedSessionAfterSend(sessionFile, bind?.purgedSession)
          }
          return bind
        }
        const pendMsg = trimmed
        try {
          const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
          const updateSentView = async (bind: Parameters<typeof afterPromptSent>[0]) => {
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              await afterPromptSent(bind)
            }
          }
          if (!running && draft) {
            if (ownsSourceView()) {
              optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
                bootstrap: true,
                attachments: allAtts,
                segments: allSegments,
                payloadText: promptText,
              })
              sendCtx.optimisticToken = optimisticToken
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { finalizeEphemeralSandboxOnFirstSend } =
              await import('@renderer/lib/ephemeral-sandbox')
            sessionFile = await finalizeEphemeralSandboxOnFirstSend(pendMsg, creationOrigin)
            sendCtx.sessionFile = sessionFile
            draftKey = composerDraftContextKey({
              ...store,
              historySessionFile: sessionFile,
              ephemeralSandboxDraft: false,
              pendingNewSessionPlaceholder: false,
            })
            sendCtx.draftKey = draftKey
            if (isCancelled()) {
              restoreUnsentDraft(true)
              return
            }
            bindOptimisticOutgoingToSession(
              optimisticToken,
              sessionFile,
            )
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            if (bind) await updateSentView(bind)
            return
          }
          if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
            if (ownsSourceView()) {
              optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
                bootstrap: true,
                attachments: allAtts,
                segments: allSegments,
                payloadText: promptText,
              })
              sendCtx.optimisticToken = optimisticToken
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { materializePendingNewSession } = await import('@renderer/lib/new-session')
            sessionFile = await materializePendingNewSession(store.currentWorkspace, pendMsg, (nextSessionFile) => {
              if (sendCtx) sendCtx.sessionFile = nextSessionFile
              draftKey = composerDraftContextKey({
                ...store,
                historySessionFile: nextSessionFile,
                pendingNewSessionPlaceholder: false,
              })
              if (sendCtx) sendCtx.draftKey = draftKey
              if (!isCancelled()) {
                bindOptimisticOutgoingToSession(optimisticToken, nextSessionFile)
              }
            }, creationOrigin)
            sendCtx.sessionFile = sessionFile
            if (isCancelled()) {
              restoreUnsentDraft(true)
              return
            }
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            if (bind) await updateSentView(bind)
            return
          }
          if (running) {
            if (isCancelled()) {
              restoreUnsentDraft(true)
              return
            }
            const queue = queueOpts?.queue ?? 'steer'
            if (queue === 'steer') {
              const bind = await ipcClient.invoke('prompt.steer', promptPayload())
              if ((bind as { cancelledBeforeSend?: boolean } | undefined)?.cancelledBeforeSend) {
                restoreUnsentDraft(true)
                return
              }
              promptAccepted = true
              await updateSentView(bind)
            } else {
              const bind = await ipcClient.invoke('prompt.followUp', promptPayload())
              if ((bind as { cancelledBeforeSend?: boolean } | undefined)?.cancelledBeforeSend) {
                restoreUnsentDraft(true)
                return
              }
              promptAccepted = true
              await updateSentView(bind)
            }
            return
          }
          if (ownsSourceView()) {
            optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
              attachments: allAtts,
              segments: allSegments,
              payloadText: promptText,
            })
            sendCtx.optimisticToken = optimisticToken
          }
          const bind = await sendPrompt()
          if (bind) await updateSentView(bind)
        } catch (e) {
          console.error('Send failed:', e)
          if (!promptAccepted) {
            restoreUnsentDraft(isCancelled())
          }
        }
      } finally {
        if (activeSendContextRef.current?.gen === sendGen) {
          activeSendContextRef.current = null
        }
        if (sendGenRef.current === sendGen || !activeSendContextRef.current) {
          sendingRef.current = false
        }
      }
    },
    [clearEditor, editorRef, inputHistory, refreshCommands, setStagedImages, stagedImages, t, updateFromEditor],
  )

  const handleSend = useCallback(
    () => sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined),
    [isRunning, sendCurrent, showComposerStop],
  )

  const runComposerAbort = useCallback(
    async (currentText: string) => {
      const store = useUIStore.getState()
      const sessionFile = store.historySessionFile
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pi-desktop:cancel-pending-send', { detail: { sessionFile } }))
      }
      useExtensionUIStore.getState().cancelForSession(sessionFile)
      await abortAgentTurn({ restoreEditorText: currentText, setEditorText: setContent })
    },
    [setContent],
  )

  const handleAbort = useCallback(() => {
    if (isComposerAbortCooldown(useUIStore.getState().historySessionFile)) return
    const el = editorRef.current
    const currentText = el ? serializeRichInput(el).displayText : text
    void runComposerAbort(currentText)
  }, [editorRef, runComposerAbort, text])

  return { sendCurrent, handleSend, runComposerAbort, handleAbort }
}
