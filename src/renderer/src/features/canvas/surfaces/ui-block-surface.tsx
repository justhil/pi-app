import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  CanvasDiagramPayload,
  CanvasMarkdownPayload,
  CanvasSurface,
  CanvasUiBlockPayload,
} from '@shared/canvas-types'
import {
  Check,
  CloudDownload,
  Copy,
  FileCode2,
  FileImage,
  MessageSquarePlus,
  RefreshCw,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { UIBlockHost } from '@renderer/features/ui-blocks/host'
import { MermaidBlock } from '@renderer/features/timeline/mermaid-block'
import { sanitizeHtml } from '@renderer/lib/sanitize'
import { CanvasViewport } from '../canvas-viewport'
import { quoteCanvasToComposer } from '../canvas-store'
import { useCanvasFileSync } from '../use-canvas-file-sync'
import { copySvgAsPng, downloadSvgAsPng } from '../svg-png-export'
import { CanvasSelectionPopover, useTextSelectionAnchor } from '../canvas-selection-popover'

const MarkdownView = lazy(() => import('@renderer/features/timeline/markdown-view'))

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeSlug(title: string): string {
  return title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'canvas'
}

export function UiBlockSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasUiBlockPayload
  const [copied, setCopied] = useState(false)
  const raw = useMemo(
    () =>
      JSON.stringify({
        component: payload.component,
        id: surface.id,
        props: payload.props ?? {},
      }),
    [payload.component, payload.props, surface.id],
  )

  const copyJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const quote = () => {
    const preview = JSON.stringify(payload.props ?? {}).slice(0, 280)
    quoteCanvasToComposer(
      `[画布组件 · ${surface.title} (${payload.component})]${payload.caption ? `\n${payload.caption}` : ''}\n数据摘要: ${preview}`,
    )
    toast.success('已引用组件信息到输入框')
  }

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11px] text-foreground-secondary">
        <span className="truncate font-mono text-[10.5px] opacity-80">{payload.component}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={copyJson}
            title="复制组件 JSON"
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={quote}
            title="引用到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5">
        {payload.caption ? (
          <p className="mb-2.5 text-[11.5px] leading-relaxed text-foreground-secondary">{payload.caption}</p>
        ) : null}
        <UIBlockHost raw={raw} streaming={false} />
      </div>
    </div>
  )
}

export function DiagramSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasDiagramPayload
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportingPng, setExportingPng] = useState(false)
  const diagramHostRef = useRef<HTMLDivElement>(null)
  const sourcePreRef = useRef<HTMLPreElement>(null)

  const fileSync = useCanvasFileSync({
    filePath: payload.filePath,
    watch: payload.watch !== false && Boolean(payload.filePath),
    mode: 'text',
  })

  const code = fileSync.content ?? payload.code ?? ''
  const isSvg = payload.format === 'svg' || (payload.filePath?.toLowerCase().endsWith('.svg') ?? false)

  const sourceSelection = useTextSelectionAnchor({
    containerRef: sourcePreRef,
    surface,
    filePath: payload.filePath,
    mode: 'source',
    sourceText: code,
    enabled: showSource,
  })

  const copyCode = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const getCurrentSvgPayload = () => {
    const svgEl = diagramHostRef.current?.querySelector('svg') as SVGSVGElement | null
    return { svgElement: svgEl, svgMarkup: isSvg ? code : undefined }
  }

  const exportSvg = () => {
    const svgEl = diagramHostRef.current?.querySelector('svg')
    const svgText = svgEl ? new XMLSerializer().serializeToString(svgEl) : isSvg ? code : ''
    if (!svgText) {
      toast.error('当前图表尚未生成可导出的 SVG')
      return
    }
    downloadBlob(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), `${safeSlug(surface.title)}.svg`)
  }

  const exportPng = async () => {
    if (exportingPng) return
    setExportingPng(true)
    try {
      const { svgElement, svgMarkup } = getCurrentSvgPayload()
      await downloadSvgAsPng({
        svgElement,
        svgMarkup,
        filename: `${safeSlug(surface.title)}-2x.png`,
        scale: 2,
      })
      toast.success('已导出高清 PNG (2x)')
    } catch (err) {
      toast.error(`PNG 导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportingPng(false)
    }
  }

  const copyPng = async () => {
    if (exportingPng) return
    setExportingPng(true)
    try {
      const { svgElement, svgMarkup } = getCurrentSvgPayload()
      await copySvgAsPng({ svgElement, svgMarkup, scale: 2 })
      toast.success('已复制高清 PNG 到剪贴板')
    } catch (err) {
      toast.error(`复制图片失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportingPng(false)
    }
  }

  const quote = () => {
    const snippet = code.slice(0, 400)
    quoteCanvasToComposer(
      `[画布图表 · ${surface.title} (${isSvg ? 'SVG' : 'Mermaid'})]${payload.filePath ? `\n文件: ${payload.filePath}` : ''}\n\`\`\`${isSvg ? 'svg' : 'mermaid'}\n${snippet}${code.length > 400 ? '\n...' : ''}\n\`\`\``,
    )
    toast.success('已引用图表到输入框')
  }

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11px] text-foreground-secondary">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
            {isSvg ? 'svg' : 'mermaid'}
          </span>
          {payload.filePath ? (
            <span className="truncate font-mono text-[10.5px] opacity-75" title={fileSync.absPath || payload.filePath}>
              {payload.filePath}
            </span>
          ) : null}
          {fileSync.watching ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="文件热重载已开启" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {payload.filePath ? (
            <button
              type="button"
              onClick={fileSync.reload}
              title="重新读取文件"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', fileSync.loading && 'animate-spin')} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? '查看图形' : '查看源码'}
            aria-pressed={showSource}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              showSource ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            <FileCode2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copyCode}
            title="复制源码"
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={exportSvg}
            title="导出 SVG"
            className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[10.5px] hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <CloudDownload className="h-3 w-3" />
            <span>SVG</span>
          </button>
          <button
            type="button"
            disabled={exportingPng}
            onClick={() => void exportPng()}
            title="导出高清 PNG (2x)"
            className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[10.5px] hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-45"
          >
            <FileImage className="h-3 w-3" />
            <span>PNG</span>
          </button>
          <button
            type="button"
            disabled={exportingPng}
            onClick={() => void copyPng()}
            title="复制高清 PNG 到剪贴板"
            aria-label="复制高清 PNG"
            className="hidden h-6 items-center rounded-md px-1.5 text-[10.5px] hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-45 sm:inline-flex"
          >
            复制图
          </button>
          <button
            type="button"
            onClick={quote}
            title="引用到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {fileSync.error ? (
        <div className="border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          文件读取失败：{fileSync.error}
        </div>
      ) : null}

      {payload.caption ? (
        <p className="shrink-0 border-b border-border/20 px-3.5 py-1.5 text-[11.5px] leading-relaxed text-foreground-secondary">
          {payload.caption}
        </p>
      ) : null}

      {showSource ? (
        <pre
          ref={sourcePreRef}
          className="min-h-0 flex-1 select-text overflow-auto bg-[var(--bg-1)]/40 p-3.5 font-mono text-[12px] leading-relaxed text-foreground"
        >
          {code}
        </pre>
      ) : (
        <CanvasViewport resetKey={`${surface.id}:${code.length}`}>
          <div ref={diagramHostRef} className="min-w-[260px]">
            {isSvg ? (
              <div
                className="flex items-center justify-center rounded-lg border border-border/40 bg-[var(--bg-1)]/40 p-3"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(code) }}
              />
            ) : (
              <MermaidBlock code={code} streaming={false} />
            )}
          </div>
        </CanvasViewport>
      )}

      <CanvasSelectionPopover anchor={sourceSelection.anchor} onClose={sourceSelection.clearAnchor} />
    </div>
  )
}

export function MarkdownSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasMarkdownPayload
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const fileSync = useCanvasFileSync({
    filePath: payload.filePath,
    watch: payload.watch !== false && Boolean(payload.filePath),
    mode: 'text',
  })

  const markdown = fileSync.content ?? payload.markdown ?? ''
  const baseDirectory = useMemo(() => {
    const abs = fileSync.absPath
    if (!abs) return undefined
    const sep = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'))
    return sep > 0 ? abs.slice(0, sep) : undefined
  }, [fileSync.absPath])

  const selection = useTextSelectionAnchor({
    containerRef: bodyRef,
    surface,
    filePath: payload.filePath,
    mode: showSource ? 'source' : 'rendered',
    sourceText: markdown,
    enabled: true,
  })

  const copyMarkdown = () => {
    void navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const quote = () => {
    const excerpt = markdown.trim().slice(0, 420)
    quoteCanvasToComposer(
      `[画布文档 · ${surface.title}]${payload.filePath ? `\n文件: ${payload.filePath}` : ''}\n${excerpt}${markdown.length > 420 ? '…' : ''}`,
    )
    toast.success('已引用文档摘要到输入框')
  }

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11px] text-foreground-secondary">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">MD</span>
          {payload.filePath ? (
            <span className="truncate font-mono text-[10.5px] opacity-75" title={fileSync.absPath || payload.filePath}>
              {payload.filePath}
            </span>
          ) : null}
          {fileSync.watching ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="文件热重载已开启" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {payload.filePath ? (
            <button
              type="button"
              onClick={fileSync.reload}
              title="重新读取文件"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', fileSync.loading && 'animate-spin')} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? '渲染视图' : '查看源码'}
            aria-pressed={showSource}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              showSource ? 'bg-foreground/[0.08] text-foreground' : 'hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            <FileCode2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copyMarkdown}
            title="复制 Markdown"
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={quote}
            title="引用到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {fileSync.error ? (
        <div className="border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          文件读取失败：{fileSync.error}
        </div>
      ) : null}

      <div ref={bodyRef} className="min-h-0 flex-1 select-text overflow-y-auto px-4 py-3.5">
        {showSource ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground">
            {markdown}
          </pre>
        ) : (
          <Suspense
            fallback={
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground-secondary">
                {markdown}
              </div>
            }
          >
            <MarkdownView baseDirectory={baseDirectory}>{markdown}</MarkdownView>
          </Suspense>
        )}
      </div>

      <CanvasSelectionPopover anchor={selection.anchor} onClose={selection.clearAnchor} />
    </div>
  )
}
