/**
 * adapter.toolCard.template === 'hashline' + protocol hashline-v1
 * 由 tool-card-template-registry 注册，不绑定具体扩展包名
 */
import { useState, type ComponentType } from 'react'
import { FileText, Hash, Plus, Minus, Search, GitBranchPlus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { CodeBlockView } from '@renderer/features/timeline/code-block-view'
import { NativePreviewPanel } from '@renderer/features/timeline/native-tool-preview-panel'
import type { ToolTimelineItem } from '@renderer/features/timeline/tool-preview-shell'
import {
  buildHashlineProtocolSummary,
  countHashlineAnchorLines,
  shouldRenderHashlineProtocol,
} from './hashline-protocol'
import { extractToolText, fileNameFromArgs, fullPathFromArgs, normalizeToolArgs } from './tool-output'

const HASHLINE_LINE = /^(\s*)(\d+)(?:#([0-9A-F]{2}))?([│|])(.*)$/
const HASHLINE_DIFF_CTX = /^(\s*)(\d+)#([0-9A-F]{2})([│|])(.*)$/
const HASHLINE_DIFF_DEL = /^-(\d+)\s*([│|])(.*)$/
const HASHLINE_DIFF_ADD = /^\+(\d+)#([0-9A-F]{2})([│|])(.*)$/

function HashBadge({ hash }: { hash?: string }) {
  if (!hash) return <span className="w-7 shrink-0" />
  return (
    <span className="w-7 shrink-0 text-center text-[10px] font-mono text-amber-600/90 dark:text-amber-400/90" title="内容哈希">
      {hash}
    </span>
  )
}

function HashlineCodeRows({ lines, lang }: { lines: string[]; lang?: string }) {
  const parsed = lines.map((line) => {
    const m = line.match(HASHLINE_LINE)
    if (m) return { kind: 'hl' as const, num: m[2], hash: m[3], body: m[5] }
    return { kind: 'plain' as const, body: line }
  })
  const hasHl = parsed.some((p) => p.kind === 'hl')
  if (!hasHl) {
    return (
      <div className="p-1">
        <CodeBlockView code={lines.join('\n')} lang={lang} previewLines={10} defaultExpanded={false} />
      </div>
    )
  }
  return (
    <div className="max-h-80 overflow-auto font-mono text-[11px] leading-[18px]">
      {parsed.map((row, i) =>
        row.kind === 'plain' ? (
          <div key={i} className="flex px-1 text-foreground-secondary whitespace-pre-wrap break-all">
            <span className="w-9 shrink-0" />
            <HashBadge />
            <span className="min-w-0 flex-1">{row.body}</span>
          </div>
        ) : (
          <div key={i} className="flex px-1 hover:bg-[var(--bg-hover)]">
            <span className="w-9 shrink-0 select-none text-right pr-1 text-foreground-secondary/50 tabular-nums">{row.num}</span>
            <HashBadge hash={row.hash} />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground">{row.body}</span>
          </div>
        ),
      )}
    </div>
  )
}

function parseHashlineDiff(text: string) {
  const rows: { kind: 'ctx' | 'add' | 'del'; lineNum?: string; hash?: string; body: string }[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const add = line.match(HASHLINE_DIFF_ADD)
    if (add) {
      rows.push({ kind: 'add', lineNum: add[1], hash: add[2], body: add[4] })
      continue
    }
    const del = line.match(HASHLINE_DIFF_DEL)
    if (del) {
      rows.push({ kind: 'del', lineNum: del[1], body: del[3] })
      continue
    }
    const ctx = line.match(HASHLINE_DIFF_CTX)
    if (ctx) {
      rows.push({ kind: 'ctx', lineNum: ctx[2], hash: ctx[3], body: ctx[5] })
      continue
    }
    if (line.startsWith(' ')) {
      const m = line.trimStart().match(HASHLINE_LINE)
      if (m) rows.push({ kind: 'ctx', lineNum: m[2], hash: m[3], body: m[5] })
    }
  }
  return rows
}

function HashlineDiffBody({ rows }: { rows: ReturnType<typeof parseHashlineDiff> }) {
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
        <span className="ml-1 flex items-center gap-0.5 text-amber-600/80">
          <Hash className="h-3 w-3" />
          hashline
        </span>
      </div>
      <div className="max-h-72 overflow-auto font-mono text-[11px] leading-[18px]">
        {rows.map((r, i) => {
          if (r.kind === 'ctx') {
            return (
              <div key={i} className="flex text-foreground-secondary/80">
                <span className="w-7 shrink-0 text-center opacity-40"> </span>
                <span className="w-9 shrink-0 text-right pr-1 tabular-nums opacity-50">{r.lineNum}</span>
                <HashBadge hash={r.hash} />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">{r.body}</span>
              </div>
            )
          }
          if (r.kind === 'del') {
            return (
              <div key={i} className="flex bg-red-500/10">
                <span className="w-7 shrink-0 text-center text-red-500">−</span>
                <span className="w-9 shrink-0 text-right pr-1 tabular-nums text-red-400/70">{r.lineNum}</span>
                <span className="w-7 shrink-0" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1 text-red-700 dark:text-red-300">{r.body}</span>
              </div>
            )
          }
          return (
            <div key={i} className="flex bg-green-500/10">
              <span className="w-7 shrink-0 text-center text-green-600">+</span>
              <span className="w-9 shrink-0 text-right pr-1 tabular-nums text-green-600/80">{r.lineNum}</span>
              <HashBadge hash={r.hash} />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1 text-green-800 dark:text-green-300">{r.body}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ReadPreview({ item }: { item: ToolTimelineItem }) {
  const args = normalizeToolArgs(item.toolArgs)
  const path = fullPathFromArgs(args)
  const name = fileNameFromArgs(args)
  const lang = guessLangFromPath(path)
  const text = extractToolText(item.toolOutput || '').replace(/\n$/, '')
  if (!text) return null
  const lines = text.split('\n')
  return (
    <NativePreviewPanel
      itemRunId={item.runId}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
      title={name}
      meta={
        <span className="flex items-center gap-1 text-[10px] text-foreground-secondary">
          <Hash className="h-3 w-3 text-amber-500/80" />
          {countHashlineAnchorLines(lines) || lines.length} 行
        </span>
      }
      defaultOpen={false}
    >
      <HashlineCodeRows lines={lines} lang={lang} />
    </NativePreviewPanel>
  )
}

function EditPreview({ item }: { item: ToolTimelineItem }) {
  const args = normalizeToolArgs(item.toolArgs)
  const name = fileNameFromArgs(args)
  const text = extractToolText(item.toolOutput || '')
  const diffRows = parseHashlineDiff(text)
  const editCount = Array.isArray(args.edits) ? args.edits.length : 0

  if (diffRows.length > 0) {
    return (
      <NativePreviewPanel
        itemRunId={item.runId}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        title={name}
        meta={<span className="text-[10px] text-foreground-secondary">hashline diff</span>}
        defaultOpen={false}
      >
        <HashlineDiffBody rows={diffRows} />
      </NativePreviewPanel>
    )
  }

  return (
    <NativePreviewPanel
      itemRunId={item.runId}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
      title={name}
      meta={
        <span className={cn('text-[10px]', item.isError ? 'text-destructive' : 'text-green-600 dark:text-green-400')}>
          {item.isError ? '失败' : editCount ? `${editCount} 处 range` : '已保存'}
        </span>
      }
      defaultOpen={false}
    >
      {text ? (
        <div className="p-2 text-[11px] font-mono whitespace-pre-wrap text-foreground-secondary">{text}</div>
      ) : (
        <div className="p-2 text-[11px] text-foreground-secondary/60">无输出</div>
      )}
    </NativePreviewPanel>
  )
}

function InsertPreview({ item }: { item: ToolTimelineItem }) {
  const args = normalizeToolArgs(item.toolArgs)
  const name = fileNameFromArgs(args)
  const edits = args.edits
  const text = extractToolText(item.toolOutput || '')
  const diffRows = parseHashlineDiff(text)
  const summary = Array.isArray(edits)
    ? edits
        .slice(0, 4)
        .map((e: any) => `${e.direction === 'before' ? '↑' : '↓'} ${e.anchor || '?'}`)
        .join(' · ')
    : ''

  if (diffRows.length > 0) {
    return (
      <NativePreviewPanel
        itemRunId={item.runId}
        icon={<GitBranchPlus className="h-3.5 w-3.5 shrink-0 text-teal-500" />}
        title={name}
        meta={<span className="text-[10px] text-foreground-secondary">insert</span>}
        defaultOpen={false}
      >
        <HashlineDiffBody rows={diffRows} />
      </NativePreviewPanel>
    )
  }

  return (
    <NativePreviewPanel
      itemRunId={item.runId}
      icon={<GitBranchPlus className="h-3.5 w-3.5 shrink-0 text-teal-500" />}
      title={name}
      meta={<span className="text-[10px] text-foreground-secondary truncate max-w-[12rem]">{summary || 'insert'}</span>}
      defaultOpen={false}
    >
      {Array.isArray(edits) && edits.length > 0 ? (
        <div className="divide-y divide-border/30 text-[11px]">
          {edits.map((e: any, i: number) => (
            <div key={i} className="px-2.5 py-1.5 font-mono">
              <span className="text-teal-600 dark:text-teal-400">{e.direction}</span>
              <span className="mx-1 text-amber-600">{e.anchor}</span>
              <span className="text-foreground-secondary">+{Array.isArray(e.lines) ? e.lines.length : 0} 行</span>
            </div>
          ))}
        </div>
      ) : text ? (
        <div className="p-2 font-mono text-[11px] whitespace-pre-wrap">{text}</div>
      ) : null}
    </NativePreviewPanel>
  )
}

function GrepPreview({ item }: { item: ToolTimelineItem }) {
  const args = normalizeToolArgs(item.toolArgs)
  const pattern = args.pattern || ''
  const text = extractToolText(item.toolOutput || '')
  const lines = text.split('\n').filter((l) => l.trim())
  const PREVIEW = 10
  const [expanded, setExpanded] = useState(false)
  const show = expanded ? lines : lines.slice(0, PREVIEW)

  return (
    <NativePreviewPanel
      itemRunId={item.runId}
      icon={<Search className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
      title={pattern ? `grep "${pattern}"` : 'grep'}
      meta={
        <span className="flex items-center gap-1 text-[10px] text-foreground-secondary">
          <Hash className="h-3 w-3" />
          {lines.length} 条
        </span>
      }
      defaultOpen={lines.length > 0 && lines.length <= 5}
    >
      {show.length === 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-foreground-secondary">无结果</div>
      ) : (
        <div className="max-h-64 overflow-auto border-t border-border/30">
          <HashlineCodeRows lines={show} />
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

function renderProtocolBody(item: ToolTimelineItem) {
  const name = item.toolName || ''
  if (name === 'insert') return <InsertPreview item={item} />
  if (name === 'edit') return <EditPreview item={item} />
  if (name === 'read') return <ReadPreview item={item} />
  if (name === 'grep') return <GrepPreview item={item} />
  return null
}

export const HashlineToolCardTemplate: ComponentType<{ item: ToolTimelineItem }> = ({ item }) => {
  const name = item.toolName || ''
  if (!shouldRenderHashlineProtocol(name, item.toolOutput || '', item.toolArgs)) return null
  const body = renderProtocolBody(item)
  return body ? <>{body}</> : null
}

export { buildHashlineProtocolSummary }