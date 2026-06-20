// Pi native tool previews for read/edit/write/grep/bash.
// Structured display inspired by Agent 桌面/桌面 Agent UI: diff for edits, file header for read,
// match lines for grep, command echo for bash.
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { FileText, Search, Terminal, ChevronDown, Plus, Minus } from 'lucide-react'

interface PreviewProps {
  toolName: string
  args: any
  output: string
  isError?: boolean
}

// ── edit/write: unified diff preview ──
function EditPreview({ args, output, isError }: { args: any; output: string; isError?: boolean }) {
  const filePath = args?.path || args?.file_path || ''
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const oldStr = args?.old_string || args?.oldString || ''
  const newStr = args?.new_string || args?.newString || ''
  const [expanded, setExpanded] = useState(true)

  if (output && output.includes('has been edited') && !oldStr && !newStr) {
    // write tool or edit without inline diff — show result line
    return (
      <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <FileText className="h-3 w-3 text-amber-500" />
          <span className="font-mono">{fileName}</span>
          <span className={cn('text-[10px]', isError ? 'text-destructive' : 'text-green-600 dark:text-green-400')}>
            {isError ? '失败' : '已编辑'}
          </span>
        </div>
      </div>
    )
  }

  // Build a simple line-level diff view
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length, 1)

  return (
    <div className="overflow-hidden rounded-md border border-border/40 bg-[#0d1117]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 border-b border-white/5 px-2.5 py-1.5 text-left"
      >
        <FileText className="h-3 w-3 text-amber-400" />
        <span className="font-mono text-[11px] text-zinc-300">{fileName}</span>
        <span className="ml-auto flex items-center gap-1 text-[9px] text-zinc-500">
          <span className="text-green-400">+{newLines.length}</span>
          <span className="text-red-400">-{oldLines.length}</span>
        </span>
        <ChevronDown className={cn('h-3 w-3 text-zinc-500 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="overflow-auto max-h-64 font-mono text-[11px] leading-[18px]">
          {Array.from({ length: maxLen }).map((_, i) => {
            const old = oldLines[i]
            const newL = newLines[i]
            if (old === newL) {
              return (
                <div key={i} className="flex">
                  <span className="w-6 shrink-0 select-none text-center text-zinc-600"> </span>
                  <span className="px-1 text-zinc-400">{old ?? ''}</span>
                </div>
              )
            }
            return (
              <div key={i}>
                {old !== undefined && old !== newL && (
                  <div className="flex bg-red-500/10">
                    <span className="w-6 shrink-0 select-none text-center text-red-400">-</span>
                    <span className="px-1 text-red-300">{old}</span>
                  </div>
                )}
                {newL !== undefined && newL !== old && (
                  <div className="flex bg-green-500/10">
                    <span className="w-6 shrink-0 select-none text-center text-green-400">+</span>
                    <span className="px-1 text-green-300">{newL}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── read: file content preview ──
function ReadPreview({ args, output }: { args: any; output: string }) {
  const filePath = args?.path || args?.file_path || ''
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const lines = (output || '').split('\n').filter(Boolean)
  const [expanded, setExpanded] = useState(false)
  const PREVIEW_LINES = 8
  const showLines = expanded ? lines : lines.slice(0, PREVIEW_LINES)

  if (lines.length === 0) return null

  return (
    <div className="overflow-hidden rounded-md border border-border/40 bg-[#0d1117]">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-2.5 py-1.5">
        <FileText className="h-3 w-3 text-blue-400" />
        <span className="font-mono text-[11px] text-zinc-300">{fileName}</span>
        <span className="ml-auto text-[9px] text-zinc-500">{lines.length} 行</span>
      </div>
      <div className="overflow-auto max-h-64 font-mono text-[11px] leading-[18px]">
        {showLines.map((line, i) => (
          <div key={i} className="flex hover:bg-white/[0.02]">
            <span className="w-8 shrink-0 select-none text-right pr-2 text-zinc-600 tabular-nums">{i + 1}</span>
            <span className="px-1 text-zinc-300 whitespace-pre-wrap break-all">{line}</span>
          </div>
        ))}
      </div>
      {lines.length > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-white/5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? '收起' : `展开 (${lines.length} 行)`}
        </button>
      )}
    </div>
  )
}

// ── grep/ffgrep: match results ──
function GrepPreview({ args, output }: { args: any; output: string }) {
  const pattern = args?.pattern || args?.query || ''
  const lines = (output || '').split('\n').filter(Boolean)
  const [expanded, setExpanded] = useState(false)
  const PREVIEW_LINES = 6
  const showLines = expanded ? lines : lines.slice(0, PREVIEW_LINES)
  const matchCount = lines.length

  return (
    <div className="overflow-hidden rounded-md border border-border/40 bg-muted/20">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <Search className="h-3 w-3 text-blue-500" />
        <span className="font-mono text-[11px] text-muted-foreground">
          grep <span className="text-foreground/80">"{pattern}"</span>
        </span>
        <span className="ml-auto text-[9px] text-muted-foreground/50">{matchCount} 匹配</span>
      </div>
      {showLines.length > 0 && (
        <div className="overflow-auto max-h-56 border-t border-border/30 font-mono text-[11px] leading-[17px]">
          {showLines.map((line, i) => {
            // Try to split file:line:content or file:content
            const m = line.match(/^([^:]+):(\d+):(.*)$/) || line.match(/^([^:]+):(.*)$/)
            if (m) {
              const [, file, lineNum, content] = m
              return (
                <div key={i} className="flex px-2.5 py-0.5 hover:bg-accent/30">
                  <span className="shrink-0 text-blue-600 dark:text-blue-400">{file}</span>
                  {lineNum && <span className="shrink-0 text-purple-600 dark:text-purple-400">:{lineNum}:</span>}
                  <span className="ml-1 text-muted-foreground/80 truncate">{content}</span>
                </div>
              )
            }
            return (
              <div key={i} className="px-2.5 py-0.5 text-muted-foreground/70 whitespace-pre-wrap break-all">{line}</div>
            )
          })}
        </div>
      )}
      {matchCount > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-border/30 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? '收起' : `展开全部 (${matchCount})`}
        </button>
      )}
    </div>
  )
}

// ── bash: command + output ──
function BashPreview({ args, output, isError }: { args: any; output: string; isError?: boolean }) {
  const command = args?.command || args?.cmd || ''
  const lines = (output || '').split('\n').filter(Boolean)
  const [expanded, setExpanded] = useState(false)
  const PREVIEW_LINES = 5
  const showLines = expanded ? lines : lines.slice(0, PREVIEW_LINES)

  return (
    <div className="overflow-hidden rounded-md border border-border/40 bg-[#0d1117]">
      {command && (
        <div className="flex items-center gap-1.5 border-b border-white/5 px-2.5 py-1.5">
          <Terminal className="h-3 w-3 shrink-0 text-green-400" />
          <span className="font-mono text-[11px] text-green-300">$ {command}</span>
        </div>
      )}
      {showLines.length > 0 && (
        <div className="overflow-auto max-h-48 p-2 font-mono text-[11px] leading-[17px]">
          {showLines.map((line, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', isError ? 'text-red-300' : 'text-zinc-300')}>
              {line}
            </div>
          ))}
        </div>
      )}
      {lines.length > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-white/5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? '收起' : `展开 (${lines.length} 行)`}
        </button>
      )}
    </div>
  )
}

// ── dispatcher ──
export function renderNativeToolPreview(item: { toolName?: string; toolArgs?: any; toolOutput?: string; isError?: boolean }): React.ReactNode | null {
  const name = item.toolName || ''
  const args = item.toolArgs
  const output = item.toolOutput || ''
  const isError = item.isError

  if (name === 'edit' || name === 'write') {
    return <EditPreview args={args} output={output} isError={isError} />
  }
  if (name === 'read') {
    return <ReadPreview args={args} output={output} />
  }
  if (name === 'grep' || name === 'ffgrep' || name === 'fffind') {
    return <GrepPreview args={args} output={output} />
  }
  if (name === 'bash') {
    return <BashPreview args={args} output={output} isError={isError} />
  }
  return null
}

// Build a short parameter summary for the collapsed tool row (桌面 Agent UI buildParamSummary style).
export function buildToolSummary(toolName: string, args: any): string {
  if (!args) return ''
  const a = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch { return null } })() : args
  if (!a || typeof a !== 'object') return ''
  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    return a.path || a.file_path || a.file_name || ''
  }
  if (toolName === 'bash') {
    return a.command || a.cmd || ''
  }
  if (toolName === 'grep' || toolName === 'ffgrep') {
    const parts: string[] = []
    if (a.pattern) parts.push(`"${a.pattern}"`)
    if (a.path) parts.push(`in ${a.path}`)
    else if (a.glob) parts.push(`in ${a.glob}`)
    return parts.join(' ')
  }
  if (toolName === 'fffind' || toolName === 'find') {
    return a.pattern || a.glob || ''
  }
  if (toolName === 'ls') {
    return a.path || ''
  }
  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    if (a[key] && typeof a[key] === 'string') return a[key]
  }
  return ''
}
