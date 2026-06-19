import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, CornerDownLeft, ArrowUp, ArrowDown, Cpu, Brain, Gauge, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { executeSlashCommand, isExecutableBuiltin, firstToken } from './slash-exec'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const model = useUIStore((s) => s.runState.model)
  const thinkingLevel = useUIStore((s) => s.runState.thinkingLevel)
  const usage = useUIStore((s) => s.runState.usage)
  const setModelPickerOpen = useUIStore((s) => s.setModelPickerOpen)
  const setThinkingPickerOpen = useUIStore((s) => s.setThinkingPickerOpen)

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
    if (!raw.trim() || !currentWorkspace) return
    setIsStreaming(true)
    try {
      await ipcClient.invoke('prompt.send', { sessionId: '', text: raw.trim() })
    } catch (e) {
      console.error('Send failed:', e)
    }
    setText('')
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

  return (
    <div className="relative border-t border-border/80 px-4 pb-3 pt-2.5">
      {showPopover && (
        <div className="absolute bottom-full left-4 right-4 mb-2 overflow-hidden rounded-lg border border-border/70 bg-popover shadow-lg">
          <div className="max-h-72 overflow-y-auto py-1">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={`${cmd.category}-${cmd.id}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => acceptCommand(cmd)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  idx === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50',
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
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                      i === argIdx ? 'bg-accent' : 'hover:bg-accent/50',
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
      <div className={cn(
        'flex items-end gap-2 rounded-xl border bg-card transition-all duration-motion-fast ease-motion-ease',
        'border-border/70 focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/30',
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:outline-none"
          placeholder={currentWorkspace ? t('composer.placeholder') : t('composer.selectProjectFirst')}
          rows={1}
          disabled={!currentWorkspace}
        />
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="m-1.5 flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-destructive/90 active:scale-[0.97]"
          >
            <Square className="h-3 w-3 fill-current" />
            {t('composer.stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !currentWorkspace}
            className="m-1.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-primary/90 active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none"
          >
            <Send className="h-3 w-3" />
            {t('composer.send')}
          </button>
        )}
      </div>

      {/* Agent 桌面-style status bar: model / thinking / context */}
      {currentWorkspace && (
        <div className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground/70">
          <button
            onClick={() => setModelPickerOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono transition-colors hover:bg-accent hover:text-foreground"
            title="切换模型"
          >
            <Cpu className="h-3 w-3" />
            <span className="max-w-[180px] truncate">{model || '未选择模型'}</span>
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>

          <span className="text-muted-foreground/30">·</span>

          <button
            onClick={() => setThinkingPickerOpen(true)}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono uppercase transition-colors hover:bg-accent hover:text-foreground',
              thinkingLevel && thinkingLevel !== 'off' ? 'text-purple-600 dark:text-purple-400' : '',
            )}
            title="切换 thinking 等级"
          >
            <Brain className="h-3 w-3" />
            <span>{thinkingLevel || 'off'}</span>
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>

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