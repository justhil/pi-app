import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Send, Square, CornerDownLeft, ArrowUp, ArrowDown, Upload, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { AttachmentMeta, getAttachmentKind, resolveFilePath, basenameOf, serializeRichInput, insertAttachmentAtCursor, renderRichTextFromPlain, renderRichFromSegments, replaceTrailingTokenInSegments, stripTrailingSlashToken, placeCaretAtEnd, type Segment } from './attachments'
import { AttachmentChip } from './attachment-chip'
import { ComposerModelStrip } from './composer-model-strip'
import { ComposerMetricsInline } from './composer-metrics-inline'
import { ComposerPendingQueue } from './composer-pending-queue'
import { useComposerMetrics } from './use-composer-metrics'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { restoreQueuedToComposer } from '@renderer/lib/composer-queue-restore'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { useComposerInputHistory, type EditorCursorAdapter } from './use-composer-input-history'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'
import { RichInput } from './rich-input'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { useVoiceInput } from './use-voice-input'
import { ComposerVoiceMicButton, ComposerVoiceInputOverlay } from './composer-voice-ui'
import {
  fetchWorkerLiveSnapshot,
  isSessionPreviewComposeLocked,
  isViewingWorkerBoundSession,
  syncViewRunStateFromWorkerSnapshot,
} from '@renderer/lib/session-worker-sync'

interface SlashCommand {
  id: string
  name: string
  description?: string
  category: 'builtin' | 'prompt' | 'skill' | 'extension'
}

// Minimal builtin command surface (handled directly in app, not via pi command API)
const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: 'model', name: '/model', category: 'builtin' },
  { id: 'thinking', name: '/thinking', category: 'builtin' },
  { id: 'clear', name: '/clear', category: 'builtin' },
  { id: 'compact', name: '/compact', category: 'builtin' },
  { id: 'new', name: '/new', category: 'builtin' },
]

const BUILTIN_CMD_I18N: Record<string, string> = {
  model: 'composer.commands.model',
  thinking: 'composer.commands.thinking',
  clear: 'composer.commands.clear',
  compact: 'composer.commands.compact',
  new: 'composer.commands.new',
}

const CATEGORY_COLORS: Record<string, string> = {
  builtin: 'bg-primary/15 text-primary',
  prompt: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  skill: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  extension: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const CATEGORY_LABEL_I18N: Record<string, string> = {
  builtin: 'composer.category.builtin',
  prompt: 'composer.category.prompt',
  skill: 'composer.category.skill',
  extension: 'composer.category.extension',
}

function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  const test = document.createRange(); test.selectNodeContents(el); test.collapse(true)
  return range.collapsed && range.compareBoundaryPoints(Range.START_TO_START, test) <= 0
}
function caretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  const test = document.createRange(); test.selectNodeContents(el); test.collapse(false)
  return range.collapsed && range.compareBoundaryPoints(Range.END_TO_END, test) >= 0
}
function caretAllSelected(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false
  const full = document.createRange(); full.selectNodeContents(el)
  return range.compareBoundaryPoints(Range.START_TO_START, full) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, full) >= 0
}
function insertBrAtCursor(el: HTMLElement) {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0)
  else { range = document.createRange(); range.selectNodeContents(el); range.collapse(false) }
  range.deleteContents()
  const br = document.createElement('br')
  const after = document.createTextNode('\u200B')
  range.insertNode(br)
  range.setStartAfter(br); range.setEndAfter(br)
  range.insertNode(after)
  range.setStartAfter(after); range.setEndAfter(after)
  sel?.removeAllRanges(); sel?.addRange(range)
  el.normalize()
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function insertTextAtCursor(el: HTMLElement, text: string) {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0)
  else { range = document.createRange(); range.selectNodeContents(el); range.collapse(false) }
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  sel?.removeAllRanges()
  sel?.addRange(range)
  el.normalize()
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function Composer() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [commandsSource, setCommandsSource] = useState<'worker' | 'fallback' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  // 文中附件：富文本编辑器内 chip 是真源；attachments state 为同步镜像，顶部与发送共用。
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepth = useRef(0)
  const editorRef = useRef<HTMLDivElement>(null)
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
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const viewingWorkerBound = isViewingWorkerBoundSession(historySessionFile, workerLiveSnapshot.sessionFile)
  const workerTurnActive = workerLiveSnapshot.status === 'running'
  /** 停止键：绑定会话且 Worker 仍在跑（切回后不等下一条事件） */
  const showComposerStop = viewingWorkerBound && (workerTurnActive || isRunning)
  const model = useUIStore((s) => s.runState.model)
  const thinkingLevel = useUIStore((s) => s.runState.thinkingLevel)
  const modelPickerOpen = useUIStore((s) => s.modelPickerOpen)
  const setModelPickerOpen = useUIStore((s) => s.setModelPickerOpen)
  const thinkingPickerOpen = useUIStore((s) => s.thinkingPickerOpen)
  const setThinkingPickerOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const [composerFocused, setComposerFocused] = useState(false)
  const composerPrefill = useUIStore((s) => s.composerPrefill)
  const setComposerPrefill = useUIStore((s) => s.setComposerPrefill)
  const metrics = useComposerMetrics()
  const { voiceState, toggle: toggleVoice, disabled: voiceDisabled } = useVoiceInput(canSendMessages, (text) => {
    const el = editorRef.current
    if (el) insertTextAtCursor(el, text)
  })
  const updateFromEditor = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const { displayText, attachments: atts } = serializeRichInput(el)
    setText(displayText)
    setAttachments(atts)
  }, [])

  const setContent = useCallback((plain: string) => {
    const el = editorRef.current
    if (!el) return
    renderRichTextFromPlain(el, plain)
    updateFromEditor()
    placeCaretAtEnd(el)
  }, [updateFromEditor])
  const inputHistory = useComposerInputHistory(currentWorkspace, currentSessionId, setContent)


  useEffect(() => {
    if (composerPrefill == null) return
    setContent(composerPrefill)
    setComposerPrefill(null)
  }, [composerPrefill, setComposerPrefill, setContent])

  useEffect(() => {
    setIsStreaming(showComposerStop)
  }, [showComposerStop])

  useEffect(() => {
    if (!historySessionFile) return
    void fetchWorkerLiveSnapshot()
      .then((snap) => {
        const store = useUIStore.getState()
        store.setWorkerLiveSnapshot(snap)
        syncViewRunStateFromWorkerSnapshot(historySessionFile, snap, (p) => store.setRunState(p))
      })
      .catch(() => {})
  }, [currentSessionId, historySessionFile])

  useEffect(() => {
    if (!canCompose) return
    // home mode / placeholder / sandbox draft 不触发 Worker IPC（Worker 可能未启动，会卡住）
    if (!currentSessionId || pendingNew || ephemeralSandboxDraft) return
    void refreshComposerRunDisplay()
  }, [canCompose, currentWorkspace, currentSessionId, ephemeralSandboxDraft, pendingNew])

  // Load authoritative command list from Worker (A-layer)
  const refreshCommands = useCallback(async () => {
    try {
      const res = await ipcClient.invoke('commands.list')
      const cmds = (res?.commands || []) as SlashCommand[]
      const names = new Set(cmds.map((c) => c.name))
      const merged = [...BUILTIN_COMMANDS.filter((b) => !names.has(b.name)), ...cmds]
      setCommands(merged)
      setCommandsSource(res?.source || 'worker')
    } catch (e) {
      console.error('commands.list failed:', e)
      setCommands(BUILTIN_COMMANDS)
    }
  }, [])

  useEffect(() => {
    if (canCompose) refreshCommands()
  }, [canCompose, refreshCommands])

  // 打开项目 / 时间线预览（pendingBind）时即可用静态目录拉全量斜杠表
  useEffect(() => {
    if (canCompose && currentWorkspace) refreshCommands()
  }, [canCompose, currentWorkspace, refreshCommands])

  useEffect(() => {
    if (currentSessionId) refreshCommands()
  }, [currentSessionId, refreshCommands])

  // Slash popover: triggered when text starts with '/' (anchored at line start or message start)
  const slashQuery = useMemo(() => {
    const m = text.match(/(?:^|\n)\/(\S*)$/)
    if (!m) return null
    return m[1] // without leading slash
  }, [text])

  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return []
    const q = slashQuery.toLowerCase()
    const seen = new Set<string>()
    return commands.filter((c) => {
      const key = c.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return !q || key.includes(q) || (c.description || '').toLowerCase().includes(q)
    })
  }, [commands, slashQuery])

  // Argument completions: when text is "/cmd args...", fetch completions for the arg prefix
  const [argCompletions, setArgCompletions] = useState<{ label: string; description?: string }[]>([])
  const [argIdx, setArgIdx] = useState(0)
  useEffect(() => { setArgIdx(0) }, [argCompletions])
  const argMatch = useMemo(() => text.match(/(?:^|\n)\/(\S+)\s+(\S*)$/), [text])
  useEffect(() => {
    if (!argMatch) { setArgCompletions([]); return }
    const cmdName = argMatch[1].replace(/^\//, '')
    const prefix = argMatch[2]
    let cancelled = false
    ipcClient.invoke('commands.completions', { commandName: cmdName, argumentPrefix: prefix })
      .then((res) => { if (!cancelled) setArgCompletions(res?.items || []) })
      .catch(() => { if (!cancelled) setArgCompletions([]) })
    return () => { cancelled = true }
  }, [argMatch])

  useEffect(() => {
    setSelectedIdx(0)
  }, [slashQuery])

  const showPopover = slashQuery !== null && filteredCommands.length > 0
  const slashPopoverAnchorRef = useRef<HTMLDivElement>(null)
  const slashListScrollRef = useRef<HTMLDivElement>(null)
  const [slashPopoverLayout, setSlashPopoverLayout] = useState<{
    left: number
    width: number
    bottom: number
    listMaxPx: number
  } | null>(null)

  useEffect(() => {
    if (!showPopover) {
      setSlashPopoverLayout(null)
      return
    }
    const sync = () => {
      const el = slashPopoverAnchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const insetX = 16
      const gap = 8
      const footerPx = 36
      const bottom = Math.max(8, window.innerHeight - r.top + gap)
      const listMaxPx = Math.max(120, Math.min(320, r.top - gap - footerPx - 16))
      setSlashPopoverLayout({
        left: r.left + insetX,
        width: Math.max(200, r.width - insetX * 2),
        bottom,
        listMaxPx,
      })
    }
    sync()
    const ro = new ResizeObserver(sync)
    const anchor = slashPopoverAnchorRef.current
    if (anchor) ro.observe(anchor)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [showPopover, text])

  useEffect(() => {
    if (!showPopover) return
    const pane = slashListScrollRef.current
    if (!pane) return
    const row = pane.querySelector(`[data-slash-idx="${selectedIdx}"]`) as HTMLElement | null
    row?.scrollIntoView({ block: 'nearest' })
  }, [showPopover, selectedIdx, filteredCommands.length])

  const clearEditor = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    renderRichTextFromPlain(el, '')
    hideAllDelayedTooltips()
    updateFromEditor()
  }, [updateFromEditor])

  const makeAdapter = useCallback((el: HTMLElement): EditorCursorAdapter => ({
    getValue: () => serializeRichInput(el).displayText,
    isEmpty: () => !el.textContent?.replace(/\u200B|\s/g, '') && !el.querySelector('[data-attachment-path]'),
    isCaretAtStart: () => caretAtStart(el),
    isCaretAtEnd: () => caretAtEnd(el),
    isAllSelected: () => caretAllSelected(el),
    selectAll: () => {
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    },
  }), [])

  const sendCurrent = async (opts?: { queue?: 'steer' | 'followUp' }) => {
    if (extensionUiBlocksComposer()) {
      toast.message(t('composer:toast.completeExtensionFirst'))
      return
    }
    const el = editorRef.current
    if (!el) return
    const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
    if (!displayText.trim() && atts.length === 0) return
    const draft = useUIStore.getState().ephemeralSandboxDraft
    if (!currentWorkspace && !draft) return
    const store = useUIStore.getState()
    const running = store.runState.status === 'running'
    if (displayText.trim()) inputHistory.recordSent(displayText.trim())
    hideAllDelayedTooltips()
    renderRichTextFromPlain(el, '')
    updateFromEditor()
    editorRef.current?.focus()
    const pendingNew = store.pendingNewSessionPlaceholder
    const homeMode = !store.currentSessionId && store.timelineItems.length === 0
    const { appendOptimisticOutgoingMessage, clearOptimisticOutgoing } = await import(
      '@renderer/lib/optimistic-send'
    )
    const sendPrompt = () => ipcClient.invoke('prompt.send', { sessionId: '', text: payload })
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
        const queue = opts?.queue ?? 'steer'
        if (queue === 'steer') {
          await ipcClient.invoke('prompt.steer', { sessionId: '', text: payload })
        } else {
          await ipcClient.invoke('prompt.followUp', { sessionId: '', text: payload })
        }
        return
      }
      appendOptimisticOutgoingMessage(pendMsg, { attachments: atts, segments })
      const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
      await sendPrompt()
      await afterPromptSent()
    } catch (e) {
      console.error('Send failed:', e)
      clearOptimisticOutgoing()
      useUIStore.getState().setRunState({ status: 'idle' })
      toast.error(t('composer:toast.sendFailed'))
    }
  }

  const handleSend = async () => {
    if (extensionUiBlocksComposer()) {
      toast.message(t('composer:toast.completeExtensionFirst'))
      return
    }
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    if (attachments.length === 0 && trimmed.startsWith('/') && isExecutableBuiltin(trimmed)) {
      const handled = await executeSlashCommand(trimmed, { refreshCommands })
      if (handled) { clearEditor(); return }
    }
    if (trimmed.startsWith('/')) {
      const routed = await routeDesktopSlashBeforeSend(trimmed)
      if (routed.handled) {
        clearEditor()
        return
      }
    }
    await sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined)
  }

  const runComposerAbort = async (currentText: string) => {
    const { dismissExtensionDialogState } = await import('@renderer/lib/extension-ui-channel')
    dismissExtensionDialogState()
    await abortAgentTurn({ restoreEditorText: currentText, setEditorText: setContent })
  }

  const handleAbort = () => {
    if (isComposerAbortCooldown()) return
    const el = editorRef.current
    const currentText = el ? serializeRichInput(el).displayText : text
    void runComposerAbort(currentText)
  }

  const applySegmentsChange = (next: Segment[]) => {
    const el = editorRef.current
    if (!el) return
    renderRichFromSegments(el, next)
    updateFromEditor()
    placeCaretAtEnd(el)
    el.focus()
  }

  const currentSegments = (): Segment[] => editorRef.current ? serializeRichInput(editorRef.current).segments : []

  const acceptCommand = (cmd: SlashCommand) => {
    applySegmentsChange(replaceTrailingTokenInSegments(currentSegments(), `${cmd.name} `))
  }

  const acceptArg = (label: string) => {
    applySegmentsChange(replaceTrailingTokenInSegments(currentSegments(), `${label} `))
    setArgCompletions([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      const handled = e.key === 'ArrowUp' ? inputHistory.tryArrowUp(adapter) : inputHistory.tryArrowDown(adapter)
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
        applySegmentsChange(stripTrailingSlashToken(currentSegments()))
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
      if (text.trim() || attachments.length > 0) handleSend()
    }
  }

  const insertMetas = useCallback((metas: AttachmentMeta[]) => {
    const el = editorRef.current
    if (!el || metas.length === 0) return
    el.focus()
    for (const m of metas) insertAttachmentAtCursor(el, m)
    updateFromEditor()
  }, [updateFromEditor])

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const metas: AttachmentMeta[] = []
    let pendingScreenshot: File | null = null
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const path = resolveFilePath(file)
      // 文件管理器复制的文件（跨平台经 Electron webUtils/path 解析出真实路径）→ 光标处插入 chip 占位
      if (path) {
        const name = file.name || basenameOf(path)
        metas.push({ path, name, kind: getAttachmentKind(name) })
        continue
      }
      // 剪贴板截图等无路径的图片：含图片项时统一阻止默认插入（禁止 <img> 进编辑器）
      if (item.type.startsWith('image/')) pendingScreenshot = file
    }
    if (metas.length > 0 || pendingScreenshot) e.preventDefault()
    if (metas.length > 0) {
      insertMetas(metas)
      return
    }
    if (pendingScreenshot) {
      const file = pendingScreenshot
      if (!currentWorkspace && !ephemeralSandboxDraft) {
        toast.message(t('composer:toast.pasteScreenshotNeedWorkspace'))
        return
      }
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1]
        if (!base64) return
        try {
          const { path } = await ipcClient.invoke('clipboard.writeTempImage', { data: base64, mimeType: file.type })
          const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : file.type === 'image/bmp' ? 'bmp' : 'png'
          const name = `clipboard-image-${Date.now()}.${ext}`
          const el = editorRef.current
          if (!el) return
          insertAttachmentAtCursor(el, { path, name, kind: 'image' })
          updateFromEditor()
        } catch (err) {
          console.error('clipboard.writeTempImage failed:', err)
          toast.error(t('composer:toast.pasteScreenshotFailed'))
        }
      }
      reader.readAsDataURL(file)
      return
    }
    const plain = e.clipboardData.getData('text/plain')
    if (plain) {
      e.preventDefault()
      const el = editorRef.current
      if (el) insertTextAtCursor(el, plain)
      updateFromEditor()
    }
  }



  // Drag & drop files into the composer. Real on-disk paths are resolved cross-platform.
  const addDroppedFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return
    const metas: AttachmentMeta[] = []
    const seen = new Set<string>()
    for (const f of files) {
      const path = resolveFilePath(f)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      const name = f.name || basenameOf(path)
      metas.push({ path, name, kind: getAttachmentKind(name) })
    }
    insertMetas(metas)
  }, [insertMetas])



  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setIsDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragActive(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    dragDepth.current = 0
    setIsDragActive(false)
    addDroppedFiles(e.dataTransfer.files)
  }, [addDroppedFiles])

  const removeAttachment = (path: string) => {
    const el = editorRef.current
    if (!el) return
    const chip = el.querySelector(`[data-attachment-path="${CSS.escape(path)}"]`) as HTMLElement | null
    if (!chip) return
    const prev = chip.previousSibling
    const next = chip.nextSibling
    if (prev && prev.nodeType === Node.TEXT_NODE && (prev.nodeValue || '') === '\u200B') prev.parentNode?.removeChild(prev)
    if (next && next.nodeType === Node.TEXT_NODE && (next.nodeValue || '') === '\u200B') next.parentNode?.removeChild(next)
    chip.parentNode?.removeChild(chip)
    el.normalize()
    updateFromEditor()
  }

  const pickAttachments = useCallback(async () => {
    if (!canCompose) return
    try {
      const res = await ipcClient.invoke('dialog:openFiles', { multiple: true })
      const paths = (res?.paths || []) as string[]
      if (paths.length === 0) return
      const metas: AttachmentMeta[] = []
      const seen = new Set<string>()
      for (const path of paths) {
        if (!path || seen.has(path)) continue
        seen.add(path)
        const name = basenameOf(path)
        metas.push({ path, name, kind: getAttachmentKind(name) })
      }
      insertMetas(metas)
    } catch (e) {
      console.error('pick attachments failed', e)
    }
  }, [canCompose, insertMetas])

  return (
    <div
      data-composer-root
      className="relative min-w-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
      {showPopover && slashPopoverLayout && createPortal(
        <div
          data-slash-popover
          className="popover-motion flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover shadow-lg"
          style={{
            position: 'fixed',
            left: slashPopoverLayout.left,
            width: slashPopoverLayout.width,
            bottom: slashPopoverLayout.bottom,
            zIndex: 10000,
            maxHeight: slashPopoverLayout.listMaxPx + 40,
          }}
        >
          <div className="relative min-h-0 shrink-0" style={{ height: slashPopoverLayout.listMaxPx }}>
            <OverlayScrollHost
              className="h-full"
              showRailOnHostHover
              scrollRef={slashListScrollRef}
              scrollClassName="composer-slash-popover-pane py-1 overscroll-contain"
            >
            {filteredCommands.map((cmd, idx) => (
              <button
                key={`${cmd.category}-${cmd.id}`}
                type="button"
                data-slash-idx={idx}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => acceptCommand(cmd)}
                className={cn(
                  'picker-row flex w-full items-center gap-2.5 px-3 py-2 text-left',
                  idx === selectedIdx && 'bg-[var(--bg-active)]',
                )}
              >
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', CATEGORY_COLORS[cmd.category])}>
                  {t(CATEGORY_LABEL_I18N[cmd.category] || 'composer.category.builtin')}
                </span>
                <span className="font-mono text-[12px] font-medium">{cmd.name}</span>
                {(cmd.description || (cmd.category === 'builtin' && BUILTIN_CMD_I18N[cmd.id])) && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {cmd.category === 'builtin' ? t(BUILTIN_CMD_I18N[cmd.id] || '') : cmd.description}
                  </span>
                )}
              </button>
            ))}
            {argCompletions.length > 0 && (
              <div className="border-t border-border/40 mt-1 pt-1">
                <div className="px-3 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/50">{t('composer:argCompletion')}</div>
                {argCompletions.map((a, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseEnter={() => setArgIdx(i)}
                    onClick={() => acceptArg(a.label)}
                    className={cn(
                      'picker-row flex w-full items-center gap-2 px-3 py-1.5 text-left',
                      i === argIdx && 'bg-[var(--bg-active)]',
                    )}
                  >
                    <CornerDownLeft className="h-3 w-3 text-muted-foreground/50" />
                    <span className="font-mono text-[12px]">{a.label}</span>
                    {a.description && <span className="ml-auto truncate text-[11px] text-muted-foreground">{a.description}</span>}
                  </button>
                ))}
              </div>
            )}
            </OverlayScrollHost>
          </div>
          <div className="flex shrink-0 items-center gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/70">
            <span className="flex items-center gap-1"><ArrowUp className="h-2.5 w-2.5" /><ArrowDown className="h-2.5 w-2.5" /> {t('composer:select')}</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="h-2.5 w-2.5" /> {t('composer:confirm')}</span>
            <span className="flex items-center gap-1">{t('composer:tabComplete')}</span>
            <span>{t('composer:escClose')}</span>
            {commandsSource === 'fallback' && (
              <span className="ml-auto text-amber-600 dark:text-amber-400">{t('composer:offlineFallback')}</span>
            )}
          </div>
        </div>,
        document.body,
      )}
      <ComposerPendingQueue />
      {sessionPreview && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200/90">
          <span className="min-w-0 flex-1">{t('composer:previewBanner')}</span>
          {workerLiveSnapshot.status === 'running' && (
            <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 font-medium">{t('composer:previewBackgroundRunning')}</span>
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
            {attachments.map((a) => (
              <AttachmentChip key={a.path} attachment={a} onRemove={() => removeAttachment(a.path)} />
            ))}
          </div>
        )}
        <div className="relative flex flex-col gap-1 px-2.5 pb-2 pt-2">
          <ComposerVoiceInputOverlay
            voiceState={voiceState}
            active={!isStreaming && !text.trim() && attachments.length === 0 && (voiceState === 'recording' || voiceState === 'transcribing')}
          />
          <RichInput
            ref={editorRef}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              inputHistory.onComposerBlur(text)
              setComposerFocused(false)
            }}
            onInput={() => { inputHistory.onUserEdit(); updateFromEditor() }}
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
              onClick={pickAttachments}
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
                const voicePrimary = !isStreaming && !hasContent
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
                    title={isStreaming ? t('composer:joinQueue') : t('composer:send')}
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