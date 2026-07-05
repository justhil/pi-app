import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { serializeRichInput } from './attachments'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'
import type { useComposerInputHistory } from './use-composer-input-history'

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
  const {
    editorRef,
    text,
    attachments,
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
      if (extensionUiBlocksComposer()) {
        toast.message(t('composer:toast.completeExtensionFirst'))
        return
      }
      const el = editorRef.current
      if (!el) return
      const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
      if (!displayText.trim() && atts.length === 0) return
      const draft = useUIStore.getState().ephemeralSandboxDraft
      const currentWorkspace = useUIStore.getState().currentWorkspace
      if (!currentWorkspace && !draft) return
      const store = useUIStore.getState()
      const running = store.runState.status === 'running'
      if (displayText.trim()) inputHistory.recordSent(displayText.trim())
      const { hideAllDelayedTooltips } = await import('./delayed-tooltip')
      hideAllDelayedTooltips()
      const { renderRichTextFromPlain } = await import('./attachments')
      renderRichTextFromPlain(el, '')
      updateFromEditor()
      editorRef.current?.focus()
      const pendingNew = store.pendingNewSessionPlaceholder
      const homeMode = !store.currentSessionId && store.timelineItems.length === 0
      const { appendOptimisticOutgoingMessage } = await import('@renderer/lib/optimistic-send')
      const promptPayload = () => ({
        sessionId: '',
        sessionFile: useUIStore.getState().historySessionFile ?? undefined,
        text: payload,
      })
      const sendPrompt = () => ipcClient.invoke('prompt.send', promptPayload())
      const pendMsg = displayText.trim()
      if (pendMsg.startsWith('/')) {
        const routed = await routeDesktopSlashBeforeSend(pendMsg)
        if (routed.handled) return
      }
      try {
        if (!running && draft) {
          appendOptimisticOutgoingMessage(pendMsg, { bootstrap: true, attachments: atts, segments })
          const { finalizeEphemeralSandboxOnFirstSend } = await import('@renderer/lib/ephemeral-sandbox')
          await finalizeEphemeralSandboxOnFirstSend(pendMsg)
          const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
          await sendPrompt()
          await afterPromptSent()
          return
        }
        if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
          appendOptimisticOutgoingMessage(pendMsg, { bootstrap: true, attachments: atts, segments })
          const { materializePendingNewSession } = await import('@renderer/lib/new-session')
          await materializePendingNewSession(store.currentWorkspace, pendMsg)
          const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
          await sendPrompt()
          await afterPromptSent()
          return
        }
        if (running) {
          const queue = queueOpts?.queue ?? 'steer'
          if (queue === 'steer') {
            await ipcClient.invoke('prompt.steer', promptPayload())
          } else {
            await ipcClient.invoke('prompt.followUp', promptPayload())
          }
          return
        }
        appendOptimisticOutgoingMessage(pendMsg, { attachments: atts, segments })
        const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
        await sendPrompt()
        await afterPromptSent()
      } catch (e) {
        console.error('Send failed:', e)
        const { clearOptimisticOutgoing } = await import('@renderer/lib/optimistic-send')
        clearOptimisticOutgoing()
        useUIStore.getState().setRunState({ status: 'idle' })
        toast.error(t('composer:toast.sendFailed'))
      }
    },
    [editorRef, inputHistory, t, updateFromEditor],
  )

  const handleSend = useCallback(async () => {
    if (extensionUiBlocksComposer()) {
      toast.message(t('composer:toast.completeExtensionFirst'))
      return
    }
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    if (attachments.length === 0 && trimmed.startsWith('/') && isExecutableBuiltin(trimmed)) {
      const handled = await executeSlashCommand(trimmed, { refreshCommands })
      if (handled) {
        clearEditor()
        return
      }
    }
    if (trimmed.startsWith('/')) {
      const routed = await routeDesktopSlashBeforeSend(trimmed)
      if (routed.handled) {
        clearEditor()
        return
      }
    }
    await sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined)
  }, [
    attachments.length,
    clearEditor,
    isRunning,
    refreshCommands,
    sendCurrent,
    showComposerStop,
    t,
    text,
  ])

  const runComposerAbort = useCallback(
    async (currentText: string) => {
      const { dismissExtensionDialogState } = await import('@renderer/lib/extension-ui-channel')
      dismissExtensionDialogState()
      await abortAgentTurn({ restoreEditorText: currentText, setEditorText: setContent })
    },
    [setContent],
  )

  const handleAbort = useCallback(() => {
    if (isComposerAbortCooldown()) return
    const el = editorRef.current
    const currentText = el ? serializeRichInput(el).displayText : text
    void runComposerAbort(currentText)
  }, [editorRef, runComposerAbort, text])

  return { sendCurrent, handleSend, runComposerAbort, handleAbort }
}