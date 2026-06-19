import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { Image as ImageIcon } from 'lucide-react'

export type ImageAsset = { path?: string; url?: string; name?: string; label?: string }

function extractTextFromOutput(out: string): string {
  if (!out) return ''
  try {
    const parsed = JSON.parse(out)
    if (Array.isArray(parsed?.content)) {
      return parsed.content
        .filter((c: any) => c?.type === 'text')
        .map((c: any) => c.text || '')
        .join('\n')
    }
    if (typeof parsed?.text === 'string') return parsed.text
  } catch {
    /* raw string */
  }
  return out
}

function collectImageAssets(toolName: string, details: any, out: string): ImageAsset[] {
  const assets: ImageAsset[] = []
  const seen = new Set<string>()

  const push = (a: ImageAsset) => {
    const key = a.path || a.url || ''
    if (!key || seen.has(key)) return
    seen.add(key)
    assets.push(a)
  }

  if (details?.file) push({ path: details.file, name: details.file.split(/[\\/]/).pop() })
  if (details?.url) push({ url: details.url, name: 'url' })
  if (Array.isArray(details?.paths)) {
    for (const p of details.paths) push({ path: p, name: String(p).split(/[\\/]/).pop() })
  }
  if (Array.isArray(details?.images)) {
    for (const img of details.images) {
      push({ path: img.path, url: img.url, name: img.name })
    }
  }

  if (toolName === 'analyze_image') {
    const text = extractTextFromOutput(out)
    const m = text.match(/filename="([^"]+)"/)
    if (m?.[1]) {
      const rel = m[1]
      const ws = useUIStore.getState().currentWorkspace
      if (ws) push({ path: `${ws.replace(/\\/g, '/')}/${rel}`, name: rel, label: '分析图' })
      else push({ name: rel, label: rel })
    }
  }

  let parsed: any = null
  try {
    parsed = typeof out === 'string' ? JSON.parse(out) : out
  } catch {
    parsed = null
  }
  const images = parsed?.images || parsed?.result?.images
  if (Array.isArray(images)) {
    for (const img of images) push({ path: img.path, url: img.url, name: img.name })
  }

  return assets
}

function InlineImagePreview({ path, enabled }: { path: string; enabled: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!enabled || !path) {
      setSrc(null)
      setErr(false)
      return
    }
    let cancelled = false
    ipcClient
      .invoke('shell.readImagePreview', { path })
      .then((res) => {
        if (cancelled) return
        if (res?.ok && res.dataUrl) setSrc(res.dataUrl)
        else setErr(true)
      })
      .catch(() => {
        if (!cancelled) setErr(true)
      })
    return () => {
      cancelled = true
    }
  }, [path, enabled])

  if (!enabled) return null
  if (err) return <div className="text-[10px] text-muted-foreground/50">无法内联预览（文件过大或格式不支持）</div>
  if (!src) return <div className="h-24 animate-pulse rounded-md bg-muted/40" />
  return (
    <img
      src={src}
      alt=""
      className="max-h-48 max-w-full rounded-md border border-border/50 object-contain"
    />
  )
}

export function ImageToolCard({ item }: { item: any }) {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [showInline, setShowInline] = useState(true)

  const details = item.toolDetails
  const assets = collectImageAssets(item.toolName, details, item.toolOutput || '')

  useEffect(() => {
    const extId =
      item.toolName === 'image_gen' || item.toolName === 'image_review'
        ? 'pi-image-gen'
        : item.toolName === 'analyze_image'
          ? 'pi-multimodal-proxy'
          : null
    if (!extId || !workspace) {
      setShowInline(true)
      return
    }
    ipcClient
      .invoke('extension.config.get', { extensionId: extId, workspaceId: workspace })
      .then((res) => {
        const v = res?.config?.showInlinePreview
        setShowInline(v !== false)
      })
      .catch(() => setShowInline(true))
  }, [item.toolName, workspace])

  const open = (p: string) => ipcClient.invoke('shell.openPath', { path: p }).catch(() => {})
  const reveal = (p: string) => ipcClient.invoke('shell.showItemInFolder', { path: p }).catch(() => {})

  const textSummary = extractTextFromOutput(item.toolOutput || '')
  const previewPath = assets.find((a) => a.path)?.path

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-pink-500/30 bg-pink-500/5 p-2.5">
      {previewPath && <InlineImagePreview path={previewPath} enabled={showInline} />}

      {assets.length === 0 && !textSummary && (
        <div className="text-[11px] text-muted-foreground/60">无图像路径（结果可能仅为文本分析）</div>
      )}

      {assets.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
          <ImageIcon className="h-3 w-3 text-pink-500" />
          {a.label && <span className="text-muted-foreground">{a.label}</span>}
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer" className="font-mono text-pink-600 hover:underline">
              {a.url}
            </a>
          )}
          {a.path && (
            <>
              <span className="font-mono text-muted-foreground truncate max-w-[240px]" title={a.path}>
                {a.name || a.path}
              </span>
              <button type="button" onClick={() => open(a.path!)} className="text-[10px] text-primary hover:underline">
                打开
              </button>
              <button
                type="button"
                onClick={() => reveal(a.path!)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                文件夹
              </button>
            </>
          )}
          {!a.path && !a.url && a.name && <span className="font-mono text-muted-foreground">{a.name}</span>}
        </div>
      ))}

      {item.toolName === 'analyze_image' && textSummary && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/30 p-2 text-[10px] text-muted-foreground">
          {textSummary.slice(0, 4000)}
        </pre>
      )}
    </div>
  )
}