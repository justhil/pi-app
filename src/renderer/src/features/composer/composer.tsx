import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, CornerDownLeft, ArrowUp, ArrowDown, Cpu, Brain, Gauge, X, FileText, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { executeSlashCommand, isExecutableBuiltin, firstToken } from './slash-exec'
import { ComposerPill } from './composer-pill'

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
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const model = useUIStore((s) => s.runState.model)
  const thinkingLevel = useUIStore((s) => s.runState.thinkingLevel)
  const usage = useUIStore((s) => s.runState.usage)
  const modelPickerOpen = useUIStore((s) => s.modelPickerOpen)
  const setModelPickerOpen = useUIStore((s) => s.setModelPickerOpen)
  const thinkingPickerOpen = useUIStore((s) => s.thinkingPickerOpen)
  const setThinkingPickerOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const [composerFocused, setComposerFocused] = useState(false)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [text, autoResize])

  useEffect(() => {
    setIsStreaming(isRunning)
  }, [isRunning])

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
    if (currentWorkspace) refreshCommands()
  }, [currentWorkspace, refreshCommands])

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
    if (!raw.trim() && attachments.length === 0) return
    if (!currentWorkspace) return
    setIsStreaming(true)
    // Append attachment paths as @-references so pi tools can act on them.
    const refs = attachments.length > 0 ? '\n' + attachments.map((a) => `@${a.path}`).join(' ') : ''
    try {
      await ipcClient.invoke('prompt.send', { sessionId: '', text: (raw.trim() + refs).trim() })
    } catch (e) {
      console.error('Send failed:', e)
    }
    setText('')
    setAttachments([])
  }

  const handleSend = async () => {
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
      } catch (e) {
        console.error('slash.resolve failed:', e)
      }
    }
    await sendText(trimmed)
  }

  const handleAbort = async () => {
    try {
      await ipcClient.invoke('prompt.abort', { sessionId: '' })
    } catch (e) {
      console.error('Abort failed:', e)
    }
    setIsStreaming(false)
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
      if (!isStreaming) handleSend()
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

  return (
    <div
      className="relative min-w-0 px-5 pb-4 pt-2 sm:px-6"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay (跨端客户端-inspired full-zone hint) */}
      {isDragActive && (
        <div className="backdrop-motion pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border border-dashed border-brand/30 bg-brand/5 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-1 text-primary/70">
            <Upload className="h-5 w-5" />
            <span className="text-[12px] font-medium">松开以添加文件</span>
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
            <span>Esc 取消</span>
            {commandsSource === 'fallback' && (
              <span className="ml-auto text-amber-600 dark:text-amber-400">静态列表（Worker 未启动）</span>
            )}
          </div>
        </div>
      )}
      <div
        className={cn(
          'composer-shell flex flex-col gap-1.5 rounded-2xl border',
          composerFocused && 'composer-shell-focused',
          isDragActive && 'border-dashed !border-primary/50',
        )}
      >
        {/* Attachment chips block (single-block layout, not scattered text) */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a, idx) => (
              <span
                key={`${a.path}-${idx}`}
                className="group row-hover inline-flex items-center gap-1 rounded-md border border-border/50 py-1 pl-2 pr-1.5 text-[11px] text-foreground-secondary" style={{ background: 'var(--bg-2)' }}
              >
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="max-w-[180px] truncate font-mono">{a.name}</span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label="移除文件"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setComposerFocused(true)}
          onBlur={() => setComposerFocused(false)}
          className="composer-textarea flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[15px] leading-[1.7] text-foreground placeholder:text-foreground-secondary/60 focus-visible:outline-none"
          placeholder={currentWorkspace ? t('composer.placeholder') : t('composer.selectProjectFirst')}
          rows={1}
          disabled={!currentWorkspace}
        />
          {isStreaming ? (
            <button
              onClick={handleAbort}
              className="m-1.5 flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition-all duration-motion-normal ease-motion-ease hover:bg-destructive/90 animate-stop-breathe"
            >
              <Square className="h-3 w-3 fill-current" />
              {t('composer.stop')}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!text.trim() && attachments.length === 0) || !currentWorkspace}
              className="composer-send m-1.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none disabled:shadow-none"
            >
              <Send className="h-3 w-3" />
              {t('composer.send')}
            </button>
          )}
        </div>
      </div>

      {/* Agent 桌面-style status bar: model / thinking / context */}
      {currentWorkspace && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-0.5 text-[11px]">
          <ComposerPill
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={model || '未选择模型'}
            open={modelPickerOpen}
            onClick={() => setModelPickerOpen(true)}
            title="切换模型"
          />
          <ComposerPill
            icon={<Brain className="h-3.5 w-3.5" />}
            label={<span className="uppercase">{thinkingLevel || 'off'}</span>}
            open={thinkingPickerOpen}
            active={!!thinkingLevel && thinkingLevel !== 'off'}
            onClick={() => setThinkingPickerOpen(true)}
            title="切换 thinking 等级"
          />

          {usage && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1 tabular-nums" title="本轮 token 用量">
                <Gauge className="h-3 w-3" />
                {formatTokens(usage.input + usage.output)}
                {usage.cacheRead > 0 && <span className="text-muted-foreground/40">（缓存 {formatTokens(usage.cacheRead)}）</span>}
              </span>
              {usage.cost > 0 && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="tabular-nums text-muted-foreground/50">${usage.cost.toFixed(4)}</span>
                </>
              )}
            </>
          )}

          {isRunning && (
            <span className="ml-auto flex items-center gap-1 text-green-600 dark:text-green-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              运行中
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}