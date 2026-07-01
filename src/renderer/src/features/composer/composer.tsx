import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, CornerDownLeft, ArrowUp, ArrowDown, X, FileText, Upload, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { executeSlashCommand, isExecutableBuiltin, firstToken } from './slash-exec'
import { ComposerModelStrip } from './composer-model-strip'
import { ComposerMetricsInline } from './composer-metrics-inline'
import { ComposerPendingQueue } from './composer-pending-queue'
import { useComposerMetrics } from './use-composer-metrics'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { restoreQueuedToComposer } from '@renderer/lib/composer-queue-restore'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'

interface SlashCommand {
  id: string
  name: string
  description?: string
  category: 'builtin' | 'prompt' | 'skill' | 'extension'
}

// Minimal builtin command surface (handled directly in app, not via pi command API)
const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: 'model', name: '/model', description: '切换或查看当前模型', category: 'builtin' },
  { id: 'thinking', name: '/thinking', description: '切换 thinking 等级', category: 'builtin' },
  { id: 'clear', name: '/clear', description: '清空当前时间线', category: 'builtin' },
  { id: 'compact', name: '/compact', description: '压缩会话历史', category: 'builtin' },
  { id: 'new', name: '/new', description: '新建会话', category: 'builtin' },
]

const CATEGORY_COLORS: Record<string, string> = {
  builtin: 'bg-primary/15 text-primary',
  prompt: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  skill: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  extension: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const CATEGORY_LABEL: Record<string, string> = {
  builtin: '内置',
  prompt: 'Prompt',
  skill: 'Skill',
  extension: '扩展',
}

export function Composer() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [commandsSource, setCommandsSource] = useState<'worker' | 'fallback' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  // File attachments: dragged/pasted files rendered as a single block of chips.
  // Only paths are carried (file reading is pi's job); the composer just assembles references.
  const [attachments, setAttachments] = useState<{ path: string; name: string; kind: 'file' | 'image' }[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepth = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const canCompose = !!currentWorkspace || ephemeralSandboxDraft
  const isRunning = useUIStore((s) => s.runState.status === 'running')
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

  useEffect(() => {
    if (composerPrefill == null) return
    setText((prev) => (prev.trim() ? prev : composerPrefill))
    setComposerPrefill(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [composerPrefill, setComposerPrefill])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 112) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [text, autoResize])

  useEffect(() => {
    setIsStreaming(isRunning)
  }, [isRunning])

  const pendingNew = useUIStore((s) => s.pendingNewSessionPlaceholder)
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
    }).slice(0, 8)
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
      .then((res) => { if (!cancelled) setArgCompletions((res?.items || []).slice(0, 6)) })
      .catch(() => { if (!cancelled) setArgCompletions([]) })
    return () => { cancelled = true }
  }, [argMatch])

  useEffect(() => {
    setSelectedIdx(0)
  }, [slashQuery])

  const showPopover = slashQuery !== null && filteredCommands.length > 0

  const sendText = async (raw: string) => {
    if (extensionUiBlocksComposer()) {
      toast.message('请先完成扩展弹窗，或点右上角稍后作答')
      return
    }
    if (!raw.trim() && attachments.length === 0) return
    const draft = useUIStore.getState().ephemeralSandboxDraft
    if (!currentWorkspace && !draft) return
    const refs = attachments.length > 0 ? '\n' + attachments.map((a) => `@${a.path}`).join(' ') : ''
    const payload = (raw.trim() + refs).trim()
    const displayText = raw.trim()
    setText('')
    setAttachments([])
    textareaRef.current?.focus()
    const store = useUIStore.getState()
    const running = store.runState.status === 'running'
    const pendingNew = store.pendingNewSessionPlaceholder
    const homeMode = !store.currentSessionId && store.timelineItems.length === 0
    const { appendOptimisticOutgoingMessage, clearOptimisticOutgoing } = await import(
      '@renderer/lib/optimistic-send'
    )
    try {
      if (!running && draft) {
        appendOptimisticOutgoingMessage(displayText, { bootstrap: true })
        const { finalizeEphemeralSandboxOnFirstSend } = await import('@renderer/lib/ephemeral-sandbox')
        await finalizeEphemeralSandboxOnFirstSend(displayText)
        const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
        await ipcClient.invoke('prompt.send', { sessionId: '', text: payload })
        await afterPromptSent()
        return
      }
      if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
        appendOptimisticOutgoingMessage(displayText, { bootstrap: true })
        const { materializePendingNewSession } = await import('@renderer/lib/new-session')
        await materializePendingNewSession(store.currentWorkspace, displayText)
        const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
        await ipcClient.invoke('prompt.send', { sessionId: '', text: payload })
        await afterPromptSent()
        return
      }
      if (running) {
        appendOptimisticOutgoingMessage(displayText)
        await ipcClient.invoke('prompt.followUp', { sessionId: '', text: payload })
        return
      }
      appendOptimisticOutgoingMessage(displayText)
      const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
      await ipcClient.invoke('prompt.send', { sessionId: '', text: payload })
      await afterPromptSent()
    } catch (e) {
      console.error('Send failed:', e)
      clearOptimisticOutgoing()
      useUIStore.getState().setRunState({ status: 'idle' })
      toast.error('发送失败')
    }
  }

  const handleSend = async () => {
    if (extensionUiBlocksComposer()) {
      toast.message('请先完成扩展弹窗，或点右上角稍后作答')
      return
    }
    const trimmed = text.trim()
    if (!trimmed) return
    // A-layer: app-native builtin -> execute directly with feedback
    if (trimmed.startsWith('/') && isExecutableBuiltin(trimmed)) {
      const handled = await executeSlashCommand(trimmed, { refreshCommands })
      if (handled) { setText(''); return }
    }
    // B-layer: extension slash dispatch (notify vs config-page)
    const token = firstToken(trimmed)
    if (token && !isExecutableBuiltin(trimmed)) {
      try {
        const r = await ipcClient.invoke('slash.resolve', { command: token })
        if (r?.behavior === 'config-page' && r?.meta) {
          useUIStore.getState().requestExtensionConfig?.(r.meta.matchNames[0] || token)
          setText('')
          toast.info(`已打开 ${r.meta.matchNames[0] || token} 配置`)
          return
        }
        if (r?.behavior === 'open-panel') {
          const panel = r.meta?.panelId || `adapter:${r.meta?.adapterId || ''}`
          if (!panel || panel === 'adapter:') {
            toast.error('斜杠未配置 panelId')
            return
          }
          useUIStore.getState().setActivePanel(panel)
          setText('')
          toast.info(r.meta?.desktopSupport || `已打开 ${panel} 面板`)
          return
        }
        if (r?.behavior === 'notify' && r?.meta?.desktopSupport) {
          setText('')
          toast.info(r.meta.desktopSupport)
          await ipcClient.invoke('prompt.send', { sessionId: '', text: trimmed })
          return
        }
        if (r?.behavior === 'execute') {
          setText('')
          await ipcClient.invoke('prompt.send', { sessionId: '', text: trimmed })
          return
        }
      } catch (e) {
        console.error('slash.resolve failed:', e)
      }
    }
    await sendText(trimmed)
  }

  const handleAbort = async () => {
    const { dismissExtensionDialogState } = await import('@renderer/lib/extension-ui-channel')
    dismissExtensionDialogState()
    try {
      await ipcClient.invoke('prompt.abort', { sessionId: '' })
    } catch (e) {
      console.error('Abort failed:', e)
    }
  }

  const acceptCommand = (cmd: SlashCommand) => {
    // Insert/replace the in-progress slash token with the chosen command name
    setText((prev) => prev.replace(/(?:^|\n)\/(\S*)$/, (_m, _p1, offset) => {
      const prefix = offset > 0 ? '\n' : ''
      return `${prefix}${cmd.name} `
    }))
    textareaRef.current?.focus()
  }

  const acceptArg = (label: string) => {
    setText((prev) => prev.replace(/(?:^|\n)(\/\S+\s+)\S*$/, (_m, p1) => `${p1}${label} `))
    setArgCompletions([])
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const alt = e.altKey
    if (alt && e.key === 'ArrowUp' && !showPopover) {
      e.preventDefault()
      void restoreQueuedToComposer({ currentText: text, setText })
      return
    }
    if (e.key === 'Escape' && isRunning && !showPopover) {
      e.preventDefault()
      void restoreQueuedToComposer({ abort: true, currentText: text, setText })
      return
    }
    if (alt && e.key === 'Enter') {
      e.preventDefault()
      if (isRunning && (text.trim() || attachments.length > 0)) {
        void sendText(text.trim())
      } else if (!isRunning && (text.trim() || attachments.length > 0)) {
        void handleSend()
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
        // Builtin commands -> execute immediately and clear; others -> insert for editing
        if (cmd.category === 'builtin' && isExecutableBuiltin(cmd.name)) {
          setText('')
          executeSlashCommand(cmd.name, { refreshCommands })
        } else {
          acceptCommand(cmd)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setText((prev) => prev.replace(/(?:^|\n)\/(\S*)$/, ''))
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() || attachments.length > 0) handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          if (currentWorkspace && text.trim()) {
            try {
              await ipcClient.invoke('prompt.sendWithImages', {
                text: text.trim(),
                images: [{ name: file.name, mimeType: file.type, data: base64 }],
              })
            } catch (err) {
              console.error('Image send failed:', err)
            }
            setText('')
          }
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }

  // Drag & drop files into the composer. Electron exposes real file paths via path.
  const addDroppedFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0) return
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path))
      const next = [...prev]
      for (const f of files) {
        const path = (f as any).path || f.name
        if (!path || seen.has(path)) continue
        seen.add(path)
        next.push({
          path,
          name: f.name || path.split(/[\\/]/).pop() || path,
          kind: f.type.startsWith('image/') ? 'image' : 'file',
        })
      }
      return next
    })
  }, [])

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

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const pickAttachments = useCallback(async () => {
    if (!canCompose) return
    try {
      const res = await ipcClient.invoke('dialog:openFiles', { multiple: true })
      const paths = (res?.paths || []) as string[]
      if (paths.length === 0) return
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        const next = [...prev]
        for (const path of paths) {
          if (!path || seen.has(path)) continue
          seen.add(path)
          const name = path.split(/[\\/]/).pop() || path
          const kind = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name) ? 'image' : 'file'
          next.push({ path, name, kind })
        }
        return next
      })
    } catch (e) {
      console.error('pick attachments failed', e)
    }
  }, [canCompose])

  return (
    <div
      data-composer-root
      className="relative min-w-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay (参考跨端客户端-inspired full-zone hint) */}
      {isDragActive && (
        <div className="backdrop-motion pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-dashed border-brand/30 bg-brand/5 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-1 text-primary/70">
            <Upload className="h-5 w-5" />
            <span className="text-[12px] font-medium">松手添加</span>
          </div>
        </div>
      )}
      {showPopover && (
        <div className="popover-motion absolute bottom-full left-4 right-4 mb-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-lg">
          <div className="max-h-72 overflow-y-auto py-1">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={`${cmd.category}-${cmd.id}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => acceptCommand(cmd)}
                className={cn(
                  'picker-row flex w-full items-center gap-2.5 px-3 py-2 text-left',
                  idx === selectedIdx && 'bg-[var(--bg-active)]',
                )}
              >
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', CATEGORY_COLORS[cmd.category])}>
                  {CATEGORY_LABEL[cmd.category]}
                </span>
                <span className="font-mono text-[12px] font-medium">{cmd.name}</span>
                {cmd.description && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">{cmd.description}</span>
                )}
              </button>
            ))}
            {argCompletions.length > 0 && (
              <div className="border-t border-border/40 mt-1 pt-1">
                <div className="px-3 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/50">参数补全</div>
                {argCompletions.map((a, i) => (
                  <button
                    key={i}
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
          </div>
          <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/70">
            <span className="flex items-center gap-1"><ArrowUp className="h-2.5 w-2.5" /><ArrowDown className="h-2.5 w-2.5" /> 选择</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="h-2.5 w-2.5" /> 确认</span>
            <span className="flex items-center gap-1">Tab 补全</span>
            <span>Esc 关闭</span>
            {commandsSource === 'fallback' && (
              <span className="ml-auto text-amber-600 dark:text-amber-400">离线命令表</span>
            )}
          </div>
        </div>
      )}
      <ComposerPendingQueue />
      <div
        className={cn(
          'composer-shell flex flex-col rounded-xl border',
          composerFocused && 'composer-shell-focused',
          isDragActive && 'border-dashed !border-primary/50',
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/25 px-3.5 pb-2 pt-2.5">
            {attachments.map((a, idx) => (
              <span
                key={`${a.path}-${idx}`}
                className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-[var(--bg-2)]/80 py-0.5 pl-2 pr-1 text-[10px] text-foreground-secondary"
              >
                <FileText className="h-2.5 w-2.5 shrink-0 opacity-60" />
                <span className="max-w-[180px] truncate font-mono">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="rounded p-0.5 opacity-50 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                  aria-label="移除文件"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1 px-2.5 pb-2 pt-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            className="composer-textarea min-h-[2.5rem] w-full resize-none bg-transparent px-0.5 py-0 text-[14px] leading-[1.55] text-foreground placeholder:text-foreground-secondary/45 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
            placeholder={
              ephemeralSandboxDraft && !currentWorkspace
                ? '首条消息即对话标题'
                : canCompose
                  ? t('composer.placeholder')
                  : t('composer.selectProjectFirst')
            }
            rows={1}
            disabled={!canCompose}
          />
          <div className="composer-toolbar flex min-h-[30px] items-center gap-1.5">
            <button
              type="button"
              onClick={pickAttachments}
              disabled={!canCompose}
              title="添加文件"
              className="composer-toolbar-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary/70 disabled:opacity-30"
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
            </button>
            {canCompose && (
              <ComposerMetricsInline metrics={metrics} isRunning={isRunning} />
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
              {isStreaming && (
                <button
                  type="button"
                  onClick={handleAbort}
                  title={t('composer.stop')}
                  className="composer-toolbar-send flex h-8 w-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={(!text.trim() && attachments.length === 0) || !canCompose}
                title={isStreaming ? '加入队列 (follow-up)' : t('composer.send')}
                className="composer-toolbar-send composer-send flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-25 disabled:pointer-events-none"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}