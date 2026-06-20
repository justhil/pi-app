// Pi 原生工具预览：read / edit / write / grep / find / bash
// 参考 Agent 桌面、Cursor、桌面 Agent UI：默认折叠、可展开、diff、Shiki 语法高亮
import { useState, type ReactNode } from 'react'
import { FileText, Search, Terminal, Plus, Minus, FolderSearch } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { CodeBlockView } from './code-block-view'
import { NativePreviewPanel } from './native-tool-preview-panel'

interface PreviewItem {
  toolName?: string
  toolArgs?: any
  toolOutput?: string
  toolDetails?: any
  runId?: string
  isError?: boolean
}

function fileNameFromArgs(args: any): string {
  const p = args?.path || args?.file_path || ''
  return p.split(/[\\/]/).pop() || p || 'file'
}

function fullPathFromArgs(args: any): string {
  return args?.path || args?.file_path || ''
}

/** 从 edit 的 patch 或 output 解析 hunks */
function parsePatchLines(patch: string): { type: 'ctx' | 'add' | 'del'; text: string }[] {
  if (!patch) return []
  const out: { type: 'ctx' | 'add' | 'del'; text: string }[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) out.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) out.push({ type: 'del', text: line.slice(1) })
    else if (line.startsWith(' ')) out.push({ type: 'ctx', text: line.slice(1) })
    else if (line.length) out.push({ type: 'ctx', text: line })
  }
  return out
}

function lineDiffRows(oldStr: string, newStr: string) {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const max = Math.max(oldLines.length, newLines.length)
  const rows: { kind: 'same' | 'del' | 'add' | 'chg'; old?: string; new?: string }[] = []
  for (let i = 0; i < max; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    if (o === n) rows.push({ kind: 'same', old: o, new: n })
    else {
      if (o !== undefined && o !== n) rows.push({ kind: 'del', old: o })
      if (n !== undefined && n !== o) rows.push({ kind: 'add', new: n })
    }
  }
  return rows
}

function DiffBody({ rows }: { rows: ReturnType<typeof lineDiffRows> }) {
  let del = 0
  let add = 0
  for (const r of rows) {
    if (r.kind === 'del') del++
    if (r.kind === 'add') add++
  }
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/30 px-2.5 py-1 text-[10px] tabular-nums text-foreground-secondary">
        <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
          <Plus className="h-3 w-3" />
          {add}
        </span>
        <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
          <Minus className="h-3 w-3" />
          {del}
        </span>
      </div>
      <div className="max-h-72 overflow-auto font-mono text-[11px] leading-[18px]">
        {rows.map((r, i) => {
          if (r.kind === 'same') {
            return (
              <div key={i} className="flex text-foreground-secondary/70">
                <span className="w-7 shrink-0 select-none text-center opacity-40"> </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">{r.old ?? ''}</span>
              </div>
            )
          }
          if (r.kind === 'del') {
            return (
              <div key={i} className="flex bg-red-500/10">
                <span className="w-7 shrink-0 select-none text-center text-red-500">−</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1 text-red-700 dark:text-red-300">{r.old}</span>
              </div>
            )
          }
          return (
            <div key={i} className="flex bg-green-500/10">
              <span className="w-7 shrink-0 select-none text-center text-green-600">+</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1 text-green-800 dark:text-green-300">{r.new}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function EditWritePreview({ item }: { item: PreviewItem }) {
  const args = item.toolArgs || {}
  const output = item.toolOutput || ''
  const path = fullPathFromArgs(args)
  const name = fileNameFromArgs(args)
  const lang = guessLangFromPath(path)
  const patch =
    item.toolDetails?.patch ||
    args?.patch ||
    (typeof output === 'string' && output.includes('@@') && output.includes('---') ? output : '')
  const oldStr = args?.old_string || args?.oldString || ''
  const newStr = args?.new_string || args?.newString || args?.content || ''

  if (patch && parsePatchLines(patch).length > 0) {
    const lines = parsePatchLines(patch)
    const rows = lines.map((l) =>
      l.type === 'add' ? { kind: 'add' as const, new: l.text } : l.type === 'del' ? { kind: 'del' as const, old: l.text } : { kind: 'same' as const, old: l.text, new: l.text },
    )
    return (
      <NativePreviewPanel itemRunId={item.runId}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        title={name}
        meta={<span className="text-[10px] text-foreground-secondary">patch</span>}
        defaultOpen={false}
      >
        <DiffBody rows={rows as any} />
      </NativePreviewPanel>
    )
  }

  if (oldStr || newStr) {
    const rows = lineDiffRows(oldStr, newStr)
    const hasDiff = rows.some((r) => r.kind !== 'same')
    if (hasDiff) {
      return (
        <NativePreviewPanel itemRunId={item.runId}
          icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          title={name}
          defaultOpen={false}
        >
          <DiffBody rows={rows} />
        </NativePreviewPanel>
      )
    }
  }

  if (item.toolName === 'write' && newStr) {
    return (
      <NativePreviewPanel itemRunId={item.runId}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        title={name}
        meta={<span className="text-[10px] text-green-600 dark:text-green-400">写入</span>}
        defaultOpen={false}
      >
        <div className="p-1">
          <CodeBlockView code={newStr} lang={lang} previewLines={6} defaultExpanded={false} />
        </div>
      </NativePreviewPanel>
    )
  }

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
      title={name}
      meta={
        <span className={cn('text-[10px]', item.isError ? 'text-destructive' : 'text-green-600 dark:text-green-400')}>
          {item.isError ? '失败' : '已保存'}
        </span>
      }
      defaultOpen={false}
    >
      {output ? (
        <div className="p-2 text-[11px] text-foreground-secondary whitespace-pre-wrap">{output}</div>
      ) : (
        <div className="p-2 text-[11px] text-foreground-secondary/60">无 diff 详情</div>
      )}
    </NativePreviewPanel>
  )
}

function ReadPreview({ item }: { item: PreviewItem }) {
  const path = fullPathFromArgs(item.toolArgs)
  const name = fileNameFromArgs(item.toolArgs)
  const lang = guessLangFromPath(path)
  const text = (item.toolOutput || '').replace(/\n$/, '')
  if (!text) return null
  const lineCount = text.split('\n').length

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
      title={name}
      meta={<span className="text-[10px] tabular-nums text-foreground-secondary">{lineCount} 行</span>}
      defaultOpen={false}
    >
      <div className="p-1">
        <CodeBlockView code={text} lang={lang} previewLines={8} defaultExpanded={false} />
      </div>
    </NativePreviewPanel>
  )
}

function highlightPattern(text: string, pattern: string): ReactNode {
  if (!pattern || !text.includes(pattern)) return text
  const parts = text.split(pattern)
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 && <mark className="rounded-sm bg-brand/25 px-0.5 text-foreground">{pattern}</mark>}
    </span>
  ))
}

function GrepFindPreview({ item, isFind }: { item: PreviewItem; isFind?: boolean }) {
  const args = item.toolArgs || {}
  const pattern = args?.pattern || args?.query || args?.glob || ''
  const output = item.toolOutput || ''
  const lines = output.split('\n').filter((l) => l.trim().length > 0)
  const PREVIEW = 8
  const [expanded, setExpanded] = useState(false)
  const show = expanded ? lines : lines.slice(0, PREVIEW)

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={isFind ? <FolderSearch className="h-3.5 w-3.5 shrink-0 text-violet-500" /> : <Search className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
      title={isFind ? `find ${pattern}` : `grep "${pattern}"`}
      meta={<span className="text-[10px] tabular-nums text-foreground-secondary">{lines.length} 条</span>}
      defaultOpen={lines.length > 0 && lines.length <= 4}
    >
      {show.length === 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-foreground-secondary">无结果</div>
      ) : (
        <div className="max-h-64 overflow-auto border-t border-border/30 font-mono text-[11px] leading-[17px]">
          {show.map((line, i) => {
            const m4 = line.match(/^([^:]+):(\d+):(.*)$/)
            if (m4) {
              const [, file, lineNum, body] = m4
              return (
                <div key={i} className="flex gap-1 border-b border-border/20 px-2 py-0.5 last:border-0 hover:bg-[var(--bg-hover)]">
                  <span className="shrink-0 text-blue-600 dark:text-blue-400">{file}</span>
                  <span className="shrink-0 text-violet-600 dark:text-violet-400">:{lineNum}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground-secondary">{highlightPattern(body, pattern)}</span>
                </div>
              )
            }
            const m3 = line.match(/^([^:]+):(.*)$/)
            if (m3) {
              const [, file, body] = m3
              return (
                <div key={i} className="flex gap-1 border-b border-border/20 px-2 py-0.5 last:border-0 hover:bg-[var(--bg-hover)]">
                  <span className="shrink-0 text-blue-600 dark:text-blue-400">{file}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground-secondary">:{highlightPattern(body, pattern)}</span>
                </div>
              )
            }
            return (
              <div key={i} className="px-2 py-0.5 text-foreground-secondary whitespace-pre-wrap break-all hover:bg-[var(--bg-hover)]">
                {highlightPattern(line, pattern)}
              </div>
            )
          })}
        </div>
      )}
      {lines.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full border-t border-border/30 py-1.5 text-center text-[10px] text-foreground-secondary hover:text-foreground"
        >
          {expanded ? '收起' : `展开全部 ${lines.length} 条`}
        </button>
      )}
    </NativePreviewPanel>
  )
}

function BashPreview({ item }: { item: PreviewItem }) {
  const command = item.toolArgs?.command || item.toolArgs?.cmd || ''
  const output = (item.toolOutput || '').replace(/\n$/, '')
  const exitHint = item.isError ? 'exit ≠ 0' : output ? '完成' : ''

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<Terminal className="h-3.5 w-3.5 shrink-0 text-green-600" />}
      title={command ? `$ ${command.length > 48 ? command.slice(0, 48) + '…' : command}` : 'bash'}
      meta={exitHint ? <span className={cn('text-[10px]', item.isError && 'text-destructive')}>{exitHint}</span> : undefined}
      defaultOpen={false}
    >
      {output ? (
        <div className="p-1">
          <CodeBlockView
            code={output}
            lang="bash"
            previewLines={5}
            defaultExpanded={false}
            className={item.isError ? 'border-destructive/30' : undefined}
          />
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11px] text-foreground-secondary/70">（无输出）</div>
      )}
    </NativePreviewPanel>
  )
}

function LsPreview({ item }: { item: PreviewItem }) {
  const path = fullPathFromArgs(item.toolArgs) || '.'
  const output = item.toolOutput || ''
  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<FolderSearch className="h-3.5 w-3.5 text-foreground-secondary" />}
      title={`ls ${path}`}
      defaultOpen={false}
    >
      <div className="p-1">
        <CodeBlockView code={output || '(empty)'} previewLines={10} defaultExpanded={false} />
      </div>
    </NativePreviewPanel>
  )
}

export function renderNativeToolPreview(item: PreviewItem): React.ReactNode | null {
  const name = item.toolName || ''
  if (name === 'edit' || name === 'write') return <EditWritePreview item={item} />
  if (name === 'read') return <ReadPreview item={item} />
  if (name === 'grep' || name === 'ffgrep') return <GrepFindPreview item={item} />
  if (name === 'fffind' || name === 'find') return <GrepFindPreview item={item} isFind />
  if (name === 'bash') return <BashPreview item={item} />
  if (name === 'ls') return <LsPreview item={item} />
  return null
}

export function buildToolSummary(toolName: string, args: any): string {
  if (!args) return ''
  const a = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch { return null } })() : args
  if (!a || typeof a !== 'object') return ''
  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    return a.path || a.file_path || a.file_name || ''
  }
  if (toolName === 'bash') {
    const c = a.command || a.cmd || ''
    return c.length > 64 ? c.slice(0, 64) + '…' : c
  }
  if (toolName === 'grep' || toolName === 'ffgrep') {
    const parts: string[] = []
    if (a.pattern) parts.push(`"${a.pattern}"`)
    if (a.path) parts.push(`in ${a.path}`)
    else if (a.glob) parts.push(a.glob)
    return parts.join(' ')
  }
  if (toolName === 'fffind' || toolName === 'find') {
    return a.pattern || a.glob || a.path || ''
  }
  if (toolName === 'ls') {
    return a.path || '.'
  }
  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    if (a[key] && typeof a[key] === 'string') return a[key]
  }
  return ''
}