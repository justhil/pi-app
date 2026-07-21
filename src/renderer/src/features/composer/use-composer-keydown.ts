import { useCallback } from 'react'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { restoreQueuedToComposer } from '@renderer/lib/composer-queue-restore'
import { insertBrAtCursor } from './composer-editor-caret'
import type { SlashCommand } from './composer-constants'
import type { EditorCursorAdapter, useComposerInputHistory } from './use-composer-input-history'

export function useComposerKeyDown(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  text: string
  attachments: unknown[]
  showPopover: boolean
  filteredCommands: SlashCommand[]
  selectedIdx: number
  setSelectedIdx: (fn: (i: number) => number) => void
  showComposerStop: boolean
  isRunning: boolean
  makeAdapter: (el: HTMLElement) => EditorCursorAdapter
  inputHistory: ReturnType<typeof useComposerInputHistory>
  setContent: (plain: string) => void
  clearEditor: () => void
  refreshCommands: () => Promise<void>
  acceptCommand: (cmd: SlashCommand) => void
  dismissSlashToken: () => void
  sendCurrent: (o?: { queue?: 'steer' | 'followUp' }) => Promise<void>
  handleSend: () => Promise<void>
  runComposerAbort: (text: string) => Promise<void>
}) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      const {
        editorRef,
        text,
        attachments,
        showPopover,
        filteredCommands,
        selectedIdx,
        setSelectedIdx,
        showComposerStop,
        isRunning,
        makeAdapter,
        inputHistory,
        setContent,
        clearEditor,
        refreshCommands,
        acceptCommand,
        dismissSlashToken,
        sendCurrent,
        handleSend,
        runComposerAbort,
      } = opts
      // 输入法正在组词时（含按 Enter 选词的瞬间），交给 IME 处理，不触发任何快捷键/发送
      if (e.nativeEvent.isComposing || e.keyCode === 229) return

      const alt = e.altKey
      if (
        !showPopover &&
        !alt &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        editorRef.current &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        const adapter = makeAdapter(editorRef.current)
        const handled =
          e.key === 'ArrowUp' ? inputHistory.tryArrowUp(adapter) : inputHistory.tryArrowDown(adapter)
        if (handled) {
          e.preventDefault()
          return
        }
      }
      if (alt && e.key === 'ArrowUp' && !showPopover) {
        e.preventDefault()
        void restoreQueuedToComposer({ currentText: text, setText: setContent })
        return
      }
      if (e.key === 'Escape' && showComposerStop && !showPopover) {
        e.preventDefault()
        void runComposerAbort(text)
        return
      }
      if (alt && e.key === 'Enter') {
        e.preventDefault()
        if (text.trim() || attachments.length > 0) {
          if (showComposerStop || isRunning) void sendCurrent({ queue: 'followUp' })
          else void handleSend()
        }
        return
      }
      if (showPopover) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIdx((i) => (i + 1) % filteredCommands.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIdx((i) => (i - 1 + filteredCommands.length) % filteredCommands.length)
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          const cmd = filteredCommands[selectedIdx]
          if (cmd.category === 'builtin' && isExecutableBuiltin(cmd.name)) {
            clearEditor()
            executeSlashCommand(cmd.name, { refreshCommands })
          } else {
            acceptCommand(cmd)
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          dismissSlashToken()
          return
        }
      }
      if (e.key === 'Enter' && e.shiftKey && editorRef.current) {
        e.preventDefault()
        insertBrAtCursor(editorRef.current)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (text.trim() || attachments.length > 0) void handleSend()
      }
    },
    [opts],
  )
}