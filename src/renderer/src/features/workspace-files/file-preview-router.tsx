import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKSPACE_TEXT_MAX_BYTES } from '@shared/workspace-preview'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost2D } from '@renderer/components/ui/overlay-scrollbar'
import { joinWorkspacePath } from './path-utils'
import { resolveFilePreviewMode } from './file-preview-mode'
import { PREVIEW_MD_MAX_CHARS, PREVIEW_MD_MAX_LINES, PREVIEW_READ_MAX_BYTES } from './file-preview-limits'
import { FileSourcePreview } from './file-source-preview'

type ReadTextFn = (
  p: string,
  opts?: { maxBytes?: number },
) => Promise<{ ok: boolean; content?: string; error?: string; size?: number; truncated?: boolean }>

function FilePreviewScroll({ children, scrollClassName }: { children: ReactNode; scrollClassName?: string }) {
  return (
    <OverlayScrollHost2D
      className="files-preview-scroll-host min-h-0 min-w-0 flex-1"
      scrollClassName={cn('min-h-full', scrollClassName)}
      showRailOnHostHover
    >
      {children}
    </OverlayScrollHost2D>
  )
}

function PlainTextFill({ content }: { content: string }) {
  return (
    <FilePreviewScroll scrollClassName="px-4 py-3">
      <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {content}
      </pre>
    </FilePreviewScroll>
  )
}

// Opaque-origin sandbox: scripts cannot access host APIs; HTTPS preview assets remain available.
const htmlPolicy = "default-src 'none'; script-src 'unsafe-inline' https: data: blob:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
const escapeScript = "window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();parent.postMessage('pi-desktop:exit-file-preview','*')}},true)"

export function FilePreviewRouter({
  workspaceRoot,
  relativePath,
  readText,
  fill = false,
  refreshKey = 0,
  onExitExpandedPreview,
}: {
  workspaceRoot: string
  relativePath: string | null
  readText: ReadTextFn
  fill?: boolean
  refreshKey?: number
  onExitExpandedPreview?: () => void
}) {
  const { t } = useTranslation('files')
  const [content, setContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fullReadPath, setFullReadPath] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const mode = relativePath ? resolveFilePreviewMode(relativePath) : null
  const absPath = relativePath ? joinWorkspacePath(workspaceRoot, relativePath) : ''
  const maxBytes = mode === 'html' || fullReadPath === absPath ? WORKSPACE_TEXT_MAX_BYTES : PREVIEW_READ_MAX_BYTES
  const htmlDocument = useMemo(() => content == null ? '' :
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlPolicy}"><script>${escapeScript}</script>${content}`, [content])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frameRef.current && event.source === frameRef.current.contentWindow && event.data === 'pi-desktop:exit-file-preview') {
        onExitExpandedPreview?.()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onExitExpandedPreview])

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setLoadError(null)
    setTruncated(false)
    setImageUrl(null)
    if (!relativePath || !mode || mode === 'pdf' || mode === 'binary' || mode === 'sheet') {
      setLoading(false)
      return
    }
    setLoading(true)
    const load = async () => {
      try {
        if (mode === 'image') {
          const result = await ipcClient.invoke('shell.readImagePreview', { workspaceRoot, path: relativePath })
          if (cancelled) return
          if (result?.ok && result.dataUrl) setImageUrl(result.dataUrl)
          else setLoadError(result?.error || 'preview_failed')
        } else {
          const result = await readText(relativePath, { maxBytes })
          if (cancelled) return
          if (!result.ok) setLoadError(result.error || 'read_failed')
          else {
            setContent(result.content ?? '')
            setTruncated(result.truncated ?? (result.size != null && result.size > maxBytes))
          }
        }
      } catch {
        if (!cancelled) setLoadError('read_failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [absPath, workspaceRoot, relativePath, mode, readText, maxBytes, refreshKey])

  const openExternal = () => void ipcClient.invoke('shell.openPath', { path: absPath })
  const wrap = (node: ReactNode) => (
    <div className={cn('flex min-h-0 min-w-0 flex-col', fill && 'flex-1')}>
      {truncated && !loading && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 text-[11px] text-foreground-secondary">
          <span>{t(maxBytes < WORKSPACE_TEXT_MAX_BYTES ? 'preview.truncated' : 'preview.previewLimit')}</span>
          {maxBytes < WORKSPACE_TEXT_MAX_BYTES && (
            <button type="button" className="text-accent hover:underline" onClick={() => setFullReadPath(absPath)}>{t('preview.tryExpandRead')}</button>
          )}
          <button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button>
        </div>
      )}
      {node}
    </div>
  )

  if (!relativePath) return wrap(<p className="px-3 py-8 text-center text-[12px] text-foreground-secondary/80">{t('preview.pickFile')}</p>)
  if (loading) return wrap(<p className="px-3 py-6 text-[12px] text-foreground-secondary/80">{t('preview.loading')}</p>)
  if (loadError) {
    const key = loadError === 'too_large' ? 'tooLarge' : loadError === 'binary' ? 'binary' : loadError === 'not_found' ? 'deleted' : 'error'
    return wrap(<div className="space-y-2 px-3 py-6 text-[12px] text-foreground-secondary"><p>{t(`preview.${key}`)}</p><button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button></div>)
  }
  if (mode === 'image') return wrap(imageUrl ? <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg-1)] p-0"><img src={imageUrl} alt={relativePath} className="max-h-full max-w-full object-contain" /></div> : null)
  if (mode === 'pdf' || mode === 'binary' || mode === 'sheet') return wrap(<div className="space-y-2 px-3 py-6 text-[12px] text-foreground-secondary"><p>{t(mode === 'pdf' ? 'preview.pdf' : 'preview.binary')}</p><button type="button" className="text-accent hover:underline" onClick={openExternal}>{t('preview.openInSystem')}</button></div>)
  if (content == null) return wrap(null)
  if (mode === 'html' && !truncated) return wrap(<iframe ref={frameRef} title="html-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={htmlDocument} className="min-h-0 w-full flex-1 border-0 bg-[var(--bg-base)]" />)
  if (mode === 'markdown' && !truncated && content.length <= PREVIEW_MD_MAX_CHARS && content.split('\n').length <= PREVIEW_MD_MAX_LINES) return wrap(<FilePreviewScroll scrollClassName="px-4 py-3"><MarkdownView>{content}</MarkdownView></FilePreviewScroll>)
  if (mode === 'code') return wrap(<FileSourcePreview code={content} lang={guessLangFromPath(relativePath)} path={relativePath} fill={fill} />)
  return wrap(<PlainTextFill content={content} />)
}
