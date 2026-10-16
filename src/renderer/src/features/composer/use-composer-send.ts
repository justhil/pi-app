import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { renderRichFromSegments, serializeRichInput } from './attachments'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { extensionUiBlocksComposer, useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import type { useComposerInputHistory } from './use-composer-input-history'
import { currentSessionCapabilities } from '@renderer/lib/session-capabilities'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  composerDraftContextKey,
  readTransientComposerDraft,
  rememberTransientComposerDraft,
} from './composer-transient-draft'

export function useComposerSend(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  text: string
  attachments: { path: string }[]
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
  const {
    editorRef,
    text,
    updateFromEditor,
    clearEditor,
    setContent,
    inputHistory,
    refreshCommands,
    showComposerStop,
    isRunning,
  } = opts

  const sendCurrent = useCallback(
    async (queueOpts?: { queue?: 'steer' | 'followUp' }) => {
      if (sendingRef.current) return
      sendingRef.current = true
      // Snapshot the switches the user sees now: sending a new chat creates its session file
      // before the prompt goes out, and the draft's switches move to it.
      const capabilities = currentSessionCapabilities()
      try {
        if (extensionUiBlocksComposer()) {
          toast.message(t('composer:toast.completeExtensionFirst'))
          return
        }
        const el = editorRef.current
        if (!el) return
        const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
        const trimmed = displayText.trim()
        if (!trimmed && atts.length === 0) return
        const store = useUIStore.getState()
        const creationOrigin = { state: store, navigationToken: getSessionNavigationToken() }
        const ownsSourceView = () => {
          const current = useUIStore.getState()
          return isSessionNavigationCurrent(creationOrigin.navigationToken) &&
            current.currentWorkspace === store.currentWorkspace &&
            current.currentSessionId === store.currentSessionId &&
            current.historySessionFile === store.historySessionFile
        }
        if (atts.length === 0 && isExecutableBuiltin(trimmed)) {
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
        }
        const draft = store.ephemeralSandboxDraft
        const currentWorkspace = store.currentWorkspace
        if (!currentWorkspace && !draft) return
        let sessionFile = store.historySessionFile ?? undefined
        const { composerTurnActive } = await import('@renderer/lib/session-worker-sync')
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
        updateFromEditor()
        editorRef.current?.focus()
        const pendingNew = store.pendingNewSessionPlaceholder
        const homeMode = !store.currentSessionId && store.timelineItems.length === 0
        const { appendOptimisticOutgoingMessage, bindOptimisticOutgoingToSession } =
          await import('@renderer/lib/optimistic-send')
        let optimisticToken: ReturnType<typeof appendOptimisticOutgoingMessage> = null
        let draftKey = composerDraftContextKey(store)
        const promptPayload = () => ({
          sessionId: '',
          sessionFile,
          text: payload,
          capabilities,
        })
        let promptAccepted = false
        const sendPrompt = async () => {
          const bind = await ipcClient.invoke('prompt.send', promptPayload())
          promptAccepted = true
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
                attachments: atts,
                segments,
              })
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { finalizeEphemeralSandboxOnFirstSend } =
              await import('@renderer/lib/ephemeral-sandbox')
            sessionFile = await finalizeEphemeralSandboxOnFirstSend(pendMsg, creationOrigin)
            draftKey = composerDraftContextKey({
              ...store,
              historySessionFile: sessionFile,
              ephemeralSandboxDraft: false,
              pendingNewSessionPlaceholder: false,
            })
            bindOptimisticOutgoingToSession(
              optimisticToken,
              sessionFile,
            )
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            await updateSentView(bind)
            return
          }
          if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
            if (ownsSourceView()) {
              optimisticToken = appendOptimisticOutgoingMessage(pendMsg, {
                bootstrap: true,
                attachments: atts,
                segments,
              })
              useUIStore.getState().setPendingTurnStage('starting')
            }
            const { materializePendingNewSession } = await import('@renderer/lib/new-session')
            sessionFile = await materializePendingNewSession(store.currentWorkspace, pendMsg, (sessionFile) => {
              draftKey = composerDraftContextKey({
                ...store,
                historySessionFile: sessionFile,
                pendingNewSessionPlaceholder: false,
              })
              bindOptimisticOutgoingToSession(optimisticToken, sessionFile)
            }, creationOrigin)
            if (sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
              useUIStore.getState().setPendingTurnStage('sending')
            }
            const bind = await sendPrompt()
            await updateSentView(bind)
            return
          }
          if (running) {
            const queue = queueOpts?.queue ?? 'steer'
            if (queue === 'steer') {
              const bind = await ipcClient.invoke('prompt.steer', promptPayload())
              promptAccepted = true
              await updateSentView(bind)
            } else {
              const bind = await ipcClient.invoke('prompt.followUp', promptPayload())
              promptAccepted = true
              await updateSentView(bind)
            }
            return
          }
          if (ownsSourceView()) {
            optimisticToken = appendOptimisticOutgoingMessage(pendMsg, { attachments: atts, segments })
          }
          const bind = await sendPrompt()
          await updateSentView(bind)
        } catch (e) {
          console.error('Send failed:', e)
          const { clearOptimisticOutgoing } = await import('@renderer/lib/optimistic-send')
          if (!promptAccepted) {
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
            if (ownsEditor) {
              renderRichFromSegments(el, restored)
              updateFromEditor()
            }
          }
          toast.error(t('composer:toast.sendFailed'))
        }
      } finally {
        sendingRef.current = false
      }
    },
    [clearEditor, editorRef, inputHistory, refreshCommands, t, updateFromEditor],
  )

  const handleSend = useCallback(
    () => sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined),
    [isRunning, sendCurrent, showComposerStop],
  )

  const runComposerAbort = useCallback(
    async (currentText: string) => {
      useExtensionUIStore.getState().cancelForSession(useUIStore.getState().historySessionFile)
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
