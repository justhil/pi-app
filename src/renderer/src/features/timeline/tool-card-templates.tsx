// Tool card template renderers (兼容层 v2).
// 通用模板，由 adapter.toolCard.template 声明调用：media/list/tree/kv/default。
// 不含任何插件名分支；所有结构化字段抽取走 adapter.toolCard.fields 或通用 details 扫描。
import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { syntaxHighlight } from '@renderer/lib/syntax-highlight'
import { FileText } from 'lucide-react'
import { renderNativeToolPreview } from './tool-previews'
import { applyToolCardFields } from '@extension-compat/json-path'
import { resolveToolCardDef } from './tool-card-registry'

export interface ToolItem {
  id?: string
  toolName?: string
  toolOutput?: string
  toolDetails?: unknown
  toolArgs?: unknown
  toolPhase?: string
  toolStatusLine?: string
  isError?: boolean
}

type ToolCardComponent = ComponentType<{ item: ToolItem }>

// ── helpers (shared across templates) ──

function extractText(out: string): string {
  if (!out) return ''
  try {
    const parsed = JSON.parse(out)
    if (Array.isArray(parsed?.content)) {
      return parsed.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c.text || '').join('\n')
    }
    if (typeof parsed?.text === 'string') return parsed.text
  } catch (e) { /* raw */ }
  return out
}

interface Asset { path?: string; url?: string; name?: string; label?: string }

// Collect image/file assets from toolDetails + output (generic: file/url/paths/images).
function collectAssets(details: Record<string, unknown> | null | undefined, out: string): Asset[] {
  const assets: Asset[] = []
  const seen = new Set<string>()
  const push = (a: Asset) => {
    const key = a.path || a.url || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    assets.push(a)
  }
  const d = details as { file?: string; url?: string; paths?: unknown[]; images?: Array<{ path?: string; url?: string; name?: string }> } | null | undefined
  if (d?.file) push({ path: d.file, name: String(d.file).split(/[\\/]/).pop() })
  if (d?.url) push({ url: d.url, name: 'url' })
  if (Array.isArray(d?.paths)) {
    for (const p of d.paths) push({ path: String(p), name: String(p).split(/[\\/]/).pop() })
  }
  if (Array.isArray(d?.images)) {
    for (const img of d.images) push({ path: img.path, url: img.url, name: img.name })
  }
  // analyze_image: extract filename from output text
  const text = extractText(out)
  const m = text.match(/filename="([^"]+)"/)
  if (m?.[1]) {
    const ws = useUIStore.getState().currentWorkspace
    if (ws) push({ path: `${ws.replace(/\\/g, '/')}/${m[1]}`, name: m[1], label: '分析图' })
    else push({ name: m[1], label: m[1] })
  }
  let parsed: { images?: unknown; result?: { images?: unknown } } | null = null
  try { parsed = typeof out === 'string' ? JSON.parse(out) : (out as typeof parsed) } catch { parsed = null }
  const imgs = parsed?.images || parsed?.result?.images
  if (Array.isArray(imgs)) for (const img of imgs) push({ path: img.path, url: img.url, name: img.name })
  return assets
}

function InlineImage({ path, workspaceRoot, enabled }: { path: string; workspaceRoot: string | null; enabled: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!enabled || !path || !workspaceRoot) { setSrc(null); setErr(false); return }
    let cancelled = false
    ipcClient.invoke('shell.readImagePreview', { workspaceRoot, path }).then((res) => {
      if (cancelled) return
      if (res?.ok && res.dataUrl) setSrc(res.dataUrl)
      else setErr(true)
    }).catch(() => { if (!cancelled) setErr(true) })
    return () => { cancelled = true }
  }, [path, workspaceRoot, enabled])
  if (!enabled) return null
  if (err) return <div className="text-[10px] text-muted-foreground/50">无法内联预览（文件过大或格式不支持）</div>
  if (!src) return <div className="h-24 animate-pulse rounded-md bg-muted/40" />
  return <img src={src} alt="" className="max-h-48 max-w-full rounded-md border border-border/50 object-contain" />
}

// ── media template (image_gen / image_review / analyze_image / multimodal) ──
const MediaTemplate: ToolCardComponent = ({ item }) => {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [showInline, setShowInline] = useState(true)
  const details = item.toolDetails as Record<string, unknown> | null | undefined
  const assets = collectAssets(details, item.toolOutput || '')

  // local showInlinePreview is adapter-local; default true if unreadable
  useEffect(() => {
    // adapterId inferred from tool catalog via shell-open config; but local flag is workspace-scoped per adapter.
    // Read via adapter.config.get using the tool's adapter id resolved server-side.
    ipcClient.invoke('adapter.config.get', { adapterId: item.toolName || '' }).then(() => setShowInline(true)).catch(() => setShowInline(true))
  }, [item.toolName])

  const open = (p: string) => ipcClient.invoke('shell.openPath', { path: p }).catch(() => {})
  const reveal = (p: string) => ipcClient.invoke('shell.showItemInFolder', { path: p }).catch(() => {})
  const textSummary = extractText(item.toolOutput || '')
  const previewPath = assets.find((a) => a.path)?.path

  return (
    <div className="mt-1 space-y-2 rounded-md border border-border/35 p-2">
      {previewPath && <InlineImage path={previewPath} workspaceRoot={workspace} enabled={showInline} />}
      {assets.length === 0 && !textSummary && (
        <div className="text-[11px] text-muted-foreground/50">—</div>
      )}
      {assets.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
          {a.label && <span className="text-muted-foreground">{a.label}</span>}
          {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">{a.url}</a>}
          {a.path && (
            <>
              <span className="font-mono text-muted-foreground truncate max-w-[240px]" title={a.path}>{a.name || a.path}</span>
              <button type="button" onClick={() => open(a.path!)} className="text-[10px] text-primary hover:underline">打开</button>
              <button type="button" onClick={() => reveal(a.path!)} className="text-[10px] text-muted-foreground hover:text-foreground">文件夹</button>
            </>
          )}
          {!a.path && !a.url && a.name && <span className="font-mono text-muted-foreground">{a.name}</span>}
        </div>
      ))}
      {textSummary && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/30 p-2 text-[10px] text-muted-foreground" style={{ background: 'color-mix(in srgb, var(--bg-2) 45%, transparent)' }}>
          {textSummary.slice(0, 4000)}
        </pre>
      )}
    </div>
  )
}

// ── tree template (subagent / trellis_subagent / contact_supervisor) ──
// Generic: parse details.results[] or single-agent shape; mode from details.mode or toolName.
const TreeTemplate: ToolCardComponent = ({ item }) => {
  const details = item.toolDetails as Record<string, unknown> | null | undefined
  const toolName = item.toolName || ''
  let mode = String(details?.mode || toolName)
  const runId = (details?.runId ?? details?.asyncId) as string | undefined
  let results: { agent?: string; status?: string; error?: string }[] = []
  const progressSummary = details?.progressSummary as { running?: number; completed?: number; failed?: number } | undefined
  if (details?.agent != null && !Array.isArray(details?.results)) {
    mode = 'trellis'
    results = [{ agent: String(details.agent), status: String(details.status ?? ''), error: details.error as string | undefined }]
  } else if (Array.isArray(details?.results)) {
    results = (details.results as Array<{ agent?: string; name?: string; status?: string; state?: string; error?: string }>).map((r) => ({
      agent: r.agent || r.name,
      status: r.status || r.state,
      error: r.error,
    }))
  }
  if (!details || results.length === 0 && !runId) {
    const out = (item.toolOutput || '').slice(0, 1200)
    return <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/35 p-2 text-[11px] text-muted-foreground" style={{ background: 'color-mix(in srgb, var(--bg-2) 45%, transparent)' }}>{out || '—'}</pre>
  }
  return (
    <div className="mt-1 space-y-2 rounded-md border border-border/35 p-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono uppercase">{mode || toolName}</span>
        {runId && <span className="truncate font-mono">{runId}</span>}
      </div>
      {progressSummary && (
        <div className="flex gap-3 text-[10px] tabular-nums text-muted-foreground">
          {progressSummary.running != null && <span>{progressSummary.running}</span>}
          {progressSummary.completed != null && <span>✓{progressSummary.completed}</span>}
          {progressSummary.failed != null && progressSummary.failed > 0 && <span>!{progressSummary.failed}</span>}
        </div>
      )}
      <div className="space-y-1">
        {results.length === 0 && <div className="text-[11px] text-muted-foreground/50">—</div>}
        {results.map((r, i) => (
          <div key={i} className={cn(
            'flex items-center justify-between gap-2 rounded-md border border-border/30 px-2 py-1',
            r.status === 'failed' || r.status === 'timedOut' ? 'border-amber-500/25 bg-amber-500/[0.04]' : '',
          )}>
            <span className="font-mono text-[11px]">{r.agent || 'agent'}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{r.status || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── list template (search / docs_search / web_fetch etc.) ──
// Generic: render a list of items (sources/results) + metadata; in-progress status from toolStatusLine.
const ListTemplate: ToolCardComponent = ({ item }) => {
  const details = item.toolDetails as Record<string, unknown> | null | undefined
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const statusLine = item.toolStatusLine
  const meta: { label: string; value: unknown }[] = []
  if (details?.session_id) meta.push({ label: 'session', value: details.session_id })
  if (details?.sources_count != null) meta.push({ label: '信源', value: details.sources_count })
  if (details?.returned_sources_count != null) meta.push({ label: '返回', value: details.returned_sources_count })
  if (details?.profile) meta.push({ label: 'profile', value: details.profile })
  if (details?.mode) meta.push({ label: 'mode', value: details.mode })
  if (details?.model) meta.push({ label: 'model', value: details.model })

  return (
    <div className="mt-1 space-y-2 rounded-md border border-border/35 p-2">
      {isRunning && statusLine ? (
        <div className="text-[11px] text-foreground-secondary/70 animate-tool-live-pulse">
          {statusLine}
        </div>
      ) : null}
      {meta.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          {meta.map((m, i) => (
            <span key={i} className="rounded-sm px-1.5 py-0.5 font-mono" style={{ background: 'color-mix(in srgb, var(--bg-2) 50%, transparent)' }}>
              <span className="text-muted-foreground/55">{m.label}</span>{' '}
              <span className="text-foreground/70">{String(m.value)}</span>
            </span>
          ))}
        </div>
      )}
      <ToolTextOutput item={item} />
    </div>
  )
}

// ── kv template (ask_user_question structured preview) ──
const KvTemplate: ToolCardComponent = ({ item }) => {
  const cardDef = resolveToolCardDef(item.toolName)
  const mapped = applyToolCardFields(
    { args: item.toolArgs, details: item.toolDetails, output: item.toolOutput },
    cardDef?.fields,
  )
  let parsed: { questions?: unknown; input?: { questions?: unknown } } | null = null
  try {
    parsed = typeof item.toolOutput === 'string' ? JSON.parse(item.toolOutput) : (item.toolOutput as unknown as typeof parsed)
  } catch {
    parsed = null
  }
  const args = item.toolArgs as { questions?: unknown } | undefined
  const questions = mapped.questions ?? parsed?.questions ?? parsed?.input?.questions ?? args?.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    return <ToolTextOutput item={item} />
  }
  return (
    <div className="mt-1 space-y-2 rounded-md border border-border/35 p-2">
      {(questions as Array<{ question?: string; options?: Array<{ label?: string }> }>).map((q, i) => (
        <div key={i}>
          <div className="text-[12px] font-medium">{q.question}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(q.options || []).map((o) => (
              <span key={o.label} className="rounded-sm border border-border/35 px-1.5 py-0.5 text-[10px] text-foreground-secondary">{o.label}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── default template (syntax-highlighted text + artifact paths) ──
const DefaultTemplate: ToolCardComponent = ({ item }) => {
  const nativePreview = renderNativeToolPreview(item, { flat: true })
  const details = item.toolDetails as { paths?: string[]; format?: string } | null | undefined
  const detailPaths: string[] = Array.isArray(details?.paths) ? details.paths : []
  const isExportTool = detailPaths.length > 0 && (item.toolName === 'preview_export' || item.toolName === 'studio_export_pdf' || item.toolName === 'studio_export_html')
  const open = (p: string) => ipcClient.invoke('shell.openPath', { path: p }).catch(() => {})
  const reveal = (p: string) => ipcClient.invoke('shell.showItemInFolder', { path: p }).catch(() => {})
  const out = item.toolOutput || ''
  const textSummary = extractText(out)

  return (
    <div className="mt-1 space-y-1">
      {nativePreview}
      {isExportTool && detailPaths.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {detailPaths.map((p, i) => {
            const name = p.split(/[\\/]/).pop() || p
            const fmt = details?.format ? String(details.format).toUpperCase() : ''
            return (
              <div key={i} className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5">
                <FileText className="h-3 w-3 text-blue-500" />
                <span className="font-mono text-[10px]">{fmt && <span className="text-muted-foreground/50 mr-1">{fmt}</span>}{name}</span>
                <button onClick={() => open(p)} className="rounded px-1 text-[10px] text-primary hover:underline">打开</button>
                <button onClick={() => reveal(p)} className="rounded px-1 text-[10px] text-muted-foreground hover:text-foreground">文件夹</button>
              </div>
            )
          })}
        </div>
      )}
      {textSummary && !nativePreview && (
        <div className="overflow-hidden rounded-md border border-border/35" style={{ background: 'color-mix(in srgb, var(--bg-2) 45%, transparent)' }}>
          <div className="overflow-auto p-2 text-[11px] font-mono leading-relaxed max-h-56">
            <pre className="whitespace-pre-wrap break-all text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeHtml(syntaxHighlight(textSummary, item.toolName || '')) }} />
          </div>
        </div>
      )}
    </div>
  )
}

// shared text output renderer (used inside list/kv fallbacks) — truncate with expand
const ToolTextOutput: ToolCardComponent = ({ item }) => {
  const { t } = useTranslation()
  const text = extractText(item.toolOutput || '')
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const PREVIEW_CHARS = 2400
  const needsFold = text.length > PREVIEW_CHARS
  const shown = expanded || !needsFold ? text : text.slice(0, PREVIEW_CHARS)
  return (
    <div className="overflow-hidden rounded-md border border-border/30" style={{ background: 'color-mix(in srgb, var(--bg-2) 40%, transparent)' }}>
      <div className={cn('overflow-auto p-2 text-[11px] font-mono leading-relaxed', expanded ? 'max-h-96' : 'max-h-40')}>
        <pre className="whitespace-pre-wrap break-all text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeHtml(syntaxHighlight(shown, item.toolName || '')) }} />
      </div>
      {needsFold && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-border/30 py-1 text-center text-[10px] text-foreground-secondary hover:text-foreground"
        >
          {expanded
            ? t('timeline:toolOutputCollapse')
            : t('timeline:toolOutputExpand', { count: text.length })}
        </button>
      )}
    </div>
  )
}

// ── template registry ──
export const TEMPLATE_RENDERERS: Record<string, ToolCardComponent> = {
  media: MediaTemplate,
  tree: TreeTemplate,
  list: ListTemplate,
  kv: KvTemplate,
  default: DefaultTemplate,
}

/** Render the appropriate template for a tool item. templateFromAdapter overrides if present. */
export function renderToolCard(item: ToolItem, templateFromAdapter?: string): React.ReactNode {
  const template = templateFromAdapter || 'default'
  const Comp = TEMPLATE_RENDERERS[template] || DefaultTemplate
  return <Comp item={item} />
}
