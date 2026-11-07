// Pi 原生工具预览：read / edit / write / grep / find / bash
// 主流 主流 Agent 桌面与 IDE：默认折叠、可展开、diff、Shiki 语法高亮
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { displayToolName, formatMcpOutput } from './mcp-tool'
import { ChevronRight, FileCode2, FileText, Search, Terminal, Plus, Minus, FolderSearch } from '@renderer/components/icons'
import { ToolIcon } from './tool-icon'
import { cn } from '@renderer/lib/utils'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { CodeBlockView } from './code-block-view'
import { NativePreviewPanel } from './native-tool-preview-panel'
import {
  extractToolText,
  fileNameFromArgs,
  fullPathFromArgs,
  normalizeToolArgs,
} from '@extension-compat/renderer/tool-output'
import {
  resolveEditWriteDiffRows,
  type DiffRow,
} from '@extension-compat/renderer/native-diff'
import { buildHashlineProtocolSummary } from '@extension-compat/renderer/hashline-protocol'
import { resolveAdapterToolCardTemplate } from './tool-card-registry'
import type { ToolTimelineItem } from './tool-preview-shell'
import {
  firstMeaningfulCodeLine,
  parseCodemodeCalls,
  stripCodemodeOutputHeader,
  summarizeCodemodeCallArg,
  summarizeCodemodeCalls,
  type CodemodeNestedCall,
  type ToolCallDetail,
} from '@shared/tool-call-detail'

function DiffBody({ rows }: { rows: DiffRow[] }) {
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

function EditWritePreview({ item, flat }: { item: ToolTimelineItem; flat?: boolean }) {
  const args = normalizeToolArgs(item.toolArgs)
  const output = extractToolText(item.toolOutput || '')
  const path = fullPathFromArgs(args)
  const name = fileNameFromArgs(args)
  const lang = guessLangFromPath(path)
  const newStr = String(args.new_string ?? args.newString ?? args.newText ?? args.content ?? '')
  const diff = resolveEditWriteDiffRows(item)

  if (diff) {
    const openDefault = false
    return (
      <NativePreviewPanel
        itemRunId={item.runId}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        title={name}
        meta={diff.label ? <span className="text-[10px] text-foreground-secondary">{diff.label}</span> : undefined}
        defaultOpen={openDefault}
        flat={flat}
      >
        <DiffBody rows={diff.rows} />
      </NativePreviewPanel>
    )
  }

  if (item.toolName === 'write' && newStr) {
    return (
      <NativePreviewPanel itemRunId={item.runId}
        icon={<FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        title={name}
        meta={<span className="text-[10px] text-green-600 dark:text-green-400">写入</span>}
        defaultOpen={false}
        flat={flat}
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
      flat={flat}
    >
      {output ? (
        <div className="p-2 text-[11px] text-foreground-secondary whitespace-pre-wrap">{output}</div>
      ) : item.toolName === 'edit' && Object.keys(args).length > 0 ? (
        <div className="p-2 text-[11px] font-mono text-foreground-secondary/80 whitespace-pre-wrap break-all">
          {JSON.stringify(args, null, 2)}
        </div>
      ) : (
        <div className="p-2 text-[11px] text-foreground-secondary/60">无 diff 详情</div>
      )}
    </NativePreviewPanel>
  )
}

function ReadPreview({ item, flat }: { item: ToolTimelineItem; flat?: boolean }) {
  const args = normalizeToolArgs(item.toolArgs)
  const path = fullPathFromArgs(args)
  const name = fileNameFromArgs(args)
  const lang = guessLangFromPath(path)
  const text = extractToolText(item.toolOutput || '').replace(/\n$/, '')
  if (!text) return null
  const lineCount = text.split('\n').length

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
      title={name}
      meta={<span className="text-[10px] tabular-nums text-foreground-secondary">{lineCount} 行</span>}
      defaultOpen={false}
      flat={flat}
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

function GrepFindPreview({ item, isFind, flat }: { item: ToolTimelineItem; isFind?: boolean; flat?: boolean }) {
  const args = normalizeToolArgs(item.toolArgs)
  const pattern = String(args?.pattern || args?.query || args?.glob || '')
  const output = extractToolText(item.toolOutput || '')
  const lines = output.split('\n').filter((l) => l.trim().length > 0)
  const PREVIEW = 8
  const [expanded, setExpanded] = useState(false)
  const show = expanded ? lines : lines.slice(0, PREVIEW)

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={isFind ? <FolderSearch className="h-3.5 w-3.5 shrink-0 text-violet-500" /> : <Search className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
      title={isFind ? `find ${pattern}` : `grep "${pattern}"`}
      meta={<span className="text-[10px] tabular-nums text-foreground-secondary">{lines.length} 条</span>}
      defaultOpen={false}
      flat={flat}
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

function BashPreview({ item, flat }: { item: ToolTimelineItem; flat?: boolean }) {
  const args = normalizeToolArgs(item.toolArgs)
  const command = String(args.command || args.cmd || '')
  const output = extractToolText(item.toolOutput || '').replace(/\n$/, '')
  const exitHint = item.isError ? 'exit ≠ 0' : output ? '完成' : ''

  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<Terminal className="h-3.5 w-3.5 shrink-0 text-green-600" />}
      title={command ? `$ ${command.length > 48 ? command.slice(0, 48) + '…' : command}` : 'bash'}
      meta={exitHint ? <span className={cn('text-[10px]', item.isError && 'text-destructive')}>{exitHint}</span> : undefined}
      defaultOpen={false}
      flat={flat}
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

function LsPreview({ item, flat }: { item: ToolTimelineItem; flat?: boolean }) {
  const path = fullPathFromArgs(normalizeToolArgs(item.toolArgs)) || '.'
  const output = extractToolText(item.toolOutput || '')
  return (
    <NativePreviewPanel itemRunId={item.runId}
      icon={<FolderSearch className="h-3.5 w-3.5 text-foreground-secondary" />}
      title={`ls ${path}`}
      defaultOpen={false}
      flat={flat}
    >
      <div className="p-1">
        <CodeBlockView code={output || '(empty)'} previewLines={10} defaultExpanded={false} />
      </div>
    </NativePreviewPanel>
  )
}

/** MCP call: arguments, then the result (pretty JSON when it is JSON), and the saved full output. */
export function McpToolPreview({ item }: { item: ToolTimelineItem }) {
  const { t } = useTranslation()
  const args = normalizeToolArgs(item.toolArgs)
  const argCode = Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : ''
  const output = formatMcpOutput(extractToolText(item.toolOutput || '').replace(/\n$/, ''))
  const fullOutputPath = (item.toolDetails as { fullOutputPath?: unknown } | null | undefined)?.fullOutputPath
  const running = item.toolPhase === 'start' || item.toolPhase === 'update'
  return (
    <div className="space-y-1 p-1">
      {argCode ? (
        <CodeBlockView code={argCode} lang="json" previewLines={6} defaultExpanded={false} />
      ) : null}
      {output.code ? (
        <CodeBlockView
          code={output.code}
          lang={output.lang}
          previewLines={8}
          defaultExpanded={false}
          className={item.isError ? 'border-destructive/30' : undefined}
        />
      ) : running ? null : (
        <div className="px-1.5 py-1 text-[11px] text-foreground-secondary/70">{t('timeline:mcp.noOutput')}</div>
      )}
      {typeof fullOutputPath === 'string' && fullOutputPath ? (
        <div className="flex items-center gap-1.5 px-1.5 text-[10px] text-foreground-secondary/70">
          <span className="min-w-0 truncate font-mono" title={fullOutputPath}>
            {t('timeline:mcp.fullOutput')} {fullOutputPath}
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-1 hover:text-foreground"
            onClick={() => ipcClient.invoke('shell.openPath', { path: fullOutputPath }).catch(() => {})}
          >
            {t('timeline:toolOpen')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

const CODEMODE_CALL_PREVIEW_COUNT = 8

function formatCodemodeDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatCodemodeCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`
}

function CodemodeNestedCallRow({ call }: { call: CodemodeNestedCall }) {
  const argSummary = summarizeCodemodeCallArg(call.name, call.args, 100)
  const duration = formatCodemodeDuration(call.durationMs)
  return (
    <div className="space-y-0.5 px-2 py-0.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-1.5">
        {call.status === 'running' ? (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-label="running" />
        ) : call.status === 'ok' ? (
          <span className="shrink-0 font-mono text-[10px] text-emerald-500" aria-label="ok">✓</span>
        ) : call.status === 'error' ? (
          <span className="shrink-0 font-mono text-[10px] text-destructive" aria-label="error">✗</span>
        ) : (
          <span className="shrink-0 font-mono text-[10px] text-foreground-secondary/50" aria-label="cancelled">⊘</span>
        )}
        <ToolIcon name={call.name} className="h-3 w-3 shrink-0 timeline-text-quiet" />
        <span className="shrink-0 font-mono font-medium text-foreground/85">{displayToolName(call.name)}</span>
        {argSummary ? (
          <span className="min-w-0 flex-1 truncate font-mono text-foreground-secondary" title={call.args}>
            {argSummary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {duration ? (
          <span className="shrink-0 font-mono text-[10px] text-foreground-secondary/60 tabular-nums">{duration}</span>
        ) : null}
        {call.cost ? (
          <span className="shrink-0 font-mono text-[10px] text-foreground-secondary/60 tabular-nums">{formatCodemodeCost(call.cost)}</span>
        ) : null}
      </div>
      {call.error ? (
        <div className="ml-5 rounded border border-destructive/25 bg-destructive/5 px-1.5 py-0.5 font-mono text-[10.5px] leading-snug text-destructive whitespace-pre-wrap break-words">
          {call.error}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Pi codemode preview:
 * - Collapsed script drawer by default (auto-open when there are no nested calls or the script itself failed)
 * - Live / settled nested tool calls list with status, summarized args, duration, and error
 * - Stripped script output without the "Script completed / Wall time" boilerplate header
 */
export function CodemodePreview({ item }: { item: ToolTimelineItem; flat?: boolean }) {
  const { t } = useTranslation()
  const args = normalizeToolArgs(item.toolArgs)
  const code = typeof args.code === 'string' ? args.code.replace(/\r/g, '').trimEnd() : ''
  const codeLines = code ? code.split('\n').length : 0
  const calls = parseCodemodeCalls(item.toolDetails)
  const rawOutput = extractToolText(item.toolOutput || '').replace(/\n$/, '')
  const stripped = stripCodemodeOutputHeader(rawOutput)
  const output = formatMcpOutput(stripped.body)
  const fullOutputPath = (item.toolDetails as { fullOutputPath?: unknown } | null | undefined)?.fullOutputPath
  const running = item.toolPhase === 'start' || item.toolPhase === 'update'

  const defaultShowScript = calls.length === 0 || (!!item.isError && calls.every((c) => c.status !== 'error'))
  const [showScript, setShowScript] = useState(defaultShowScript)
  const [showAllCalls, setShowAllCalls] = useState(false)

  const hiddenCallsCount = Math.max(0, calls.length - CODEMODE_CALL_PREVIEW_COUNT)
  const visibleCalls = showAllCalls || hiddenCallsCount === 0 ? calls : calls.slice(-CODEMODE_CALL_PREVIEW_COUNT)
  const priced = calls.filter((c) => typeof c.cost === 'number' && c.cost > 0)
  const totalCost = priced.reduce((sum, c) => sum + (c.cost ?? 0), 0)

  return (
    <div className="space-y-1 p-1">
      {code ? (
        <div className="overflow-hidden rounded-md border border-border/35" style={{ background: 'color-mix(in srgb, var(--bg-2) 45%, transparent)' }}>
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              aria-expanded={showScript}
              className="flex min-w-0 items-center gap-1 text-foreground-secondary hover:text-foreground"
            >
              <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', showScript && 'rotate-90')} />
              <FileCode2 className="h-3 w-3 shrink-0 opacity-75" />
              <span className="truncate font-mono text-[10.5px]">
                {t('timeline:codemode.scriptLines', { count: codeLines })}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-foreground-secondary/70 tabular-nums">
              {calls.length > 0 ? <span>{t('timeline:codemode.callsCount', { count: calls.length })}</span> : null}
              {totalCost > 0 ? <span>{t('timeline:codemode.modelCost', { cost: formatCodemodeCost(totalCost) })}</span> : null}
              {stripped.wallTimeSeconds !== undefined ? <span>{stripped.wallTimeSeconds.toFixed(1)}s</span> : null}
            </div>
          </div>
          {showScript ? (
            <div className="border-t border-border/30 p-1">
              <CodeBlockView code={code} lang="javascript" previewLines={10} defaultExpanded={false} />
            </div>
          ) : null}
        </div>
      ) : null}

      {calls.length > 0 ? (
        <div
          className="divide-y divide-border/20 overflow-hidden rounded-md border border-border/35 py-0.5"
          style={{ background: 'color-mix(in srgb, var(--bg-2) 38%, transparent)' }}
        >
          {hiddenCallsCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllCalls((v) => !v)}
              className="w-full px-2 py-1 text-left font-mono text-[10px] text-foreground-secondary/75 hover:text-foreground"
            >
              {showAllCalls
                ? t('timeline:codemode.collapseCalls')
                : t('timeline:codemode.earlierCalls', { count: hiddenCallsCount })}
            </button>
          ) : null}
          {visibleCalls.map((call, idx) => (
            <CodemodeNestedCallRow key={call.id || `${call.name}-${idx}`} call={call} />
          ))}
        </div>
      ) : null}

      {output.code ? (
        <CodeBlockView
          code={output.code}
          lang={output.lang}
          previewLines={8}
          defaultExpanded={false}
          className={item.isError ? 'border-destructive/30' : undefined}
        />
      ) : running ? null : calls.length === 0 ? (
        <div className="px-1.5 py-1 text-[11px] text-foreground-secondary/70">{t('timeline:mcp.noOutput')}</div>
      ) : null}

      {typeof fullOutputPath === 'string' && fullOutputPath ? (
        <div className="flex items-center gap-1.5 px-1.5 text-[10px] text-foreground-secondary/70">
          <span className="min-w-0 truncate font-mono" title={fullOutputPath}>
            {t('timeline:mcp.fullOutput')} {fullOutputPath}
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-1 hover:text-foreground"
            onClick={() => ipcClient.invoke('shell.openPath', { path: fullOutputPath }).catch(() => {})}
          >
            {t('timeline:toolOpen')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function renderNativeToolPreview(
  item: ToolTimelineItem,
  opts?: { flat?: boolean },
): React.ReactNode | null {
  const name = item.toolName || ''
  const flat = opts?.flat === true
  if (name === 'codemode') return <CodemodePreview item={item} flat={flat} />
  if (name === 'edit' || name === 'write') return <EditWritePreview item={item} flat={flat} />
  if (name === 'read') return <ReadPreview item={item} flat={flat} />
  if (name === 'grep' || name === 'ffgrep') return <GrepFindPreview item={item} flat={flat} />
  if (name === 'fffind' || name === 'find') return <GrepFindPreview item={item} isFind flat={flat} />
  if (name === 'bash') return <BashPreview item={item} flat={flat} />
  if (name === 'ls') return <LsPreview item={item} flat={flat} />
  return null
}

function summaryFromDetail(detail: ToolCallDetail | undefined): string | null {
  if (!detail) return null
  if (detail.type === 'bash') return detail.command.slice(0, 120)
  if (detail.type === 'read' || detail.type === 'write' || detail.type === 'edit') return detail.path
  if (detail.type === 'grep' || detail.type === 'find') return detail.pattern
  if (detail.type === 'codemode') return detail.summary
  return null
}

export function buildToolSummary(toolName: string, args: unknown, detail?: ToolCallDetail, details?: unknown): string {
  if (toolName === 'codemode') {
    const calls = parseCodemodeCalls(details)
    const wallTimeSeconds = detail?.type === 'codemode' ? detail.wallTimeSeconds : undefined
    if (calls.length > 0) return summarizeCodemodeCalls(calls, { wallTimeSeconds })
  }
  const fromDetail = summaryFromDetail(detail)
  if (fromDetail) return fromDetail
  if (!args) return ''
  const a = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch (e) { return null } })() : args
  if (!a || typeof a !== 'object') return ''
  if (resolveAdapterToolCardTemplate(toolName) === 'hashline') {
    const s = buildHashlineProtocolSummary(toolName, a)
    if (s) return s
  }
  if (toolName === 'edit' && Array.isArray(a.edits)) {
    const p = a.path || a.file_path || ''
    return p ? `${p} · ${a.edits.length} edits` : `${a.edits.length} edits`
  }
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
  if (toolName === 'codemode') {
    return firstMeaningfulCodeLine(typeof a.code === 'string' ? a.code : '')
  }
  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    if (a[key] && typeof a[key] === 'string') return a[key]
  }
  return ''
}