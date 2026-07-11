import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHost2D } from '@renderer/components/ui/overlay-scrollbar'
import { joinWorkspacePath } from './path-utils'
import { resolveFilePreviewMode } from './file-preview-mode'
import { PREVIEW_READ_MAX_BYTES } from './file-preview-limits'
import { FileSourcePreview } from './file-source-preview'

const IPC_READ_MAX_BYTES = 1024 * 1024

type ReadTextFn = (
  p: string,
  opts?: { maxBytes?: number },
) => Promise<{ ok: boolean; content?: string; error?: string; size?: number }>

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

export function FilePreviewRouter({
  workspaceRoot,
  relativePath,
  readText,
  fill = false,
  refreshKey = 0,
}: {
  workspaceRoot: string
  relativePath: string | null
  readText: ReadTextFn
  fill?: boolean
  refreshKey?: number
}) {
  const { t } = useTranslation('files')
  const [content, setContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readComplete, setReadComplete] = useState(true)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const mode = useMemo(
    () => (relativePath ? resolveFilePreviewMode(relativePath) : null),
    [relativePath],
  )

  const absPath = relativePath ? joinWorkspacePath(workspaceRoot, relativePath) : ''

  const loadContent = useCallback(
    async (maxBytes: number, cancelled: () => boolean) => {
      const res = await readText(relativePath!, { maxBytes })
      if (cancelled()) return
      if (!res.ok) {
        setLoadError(res.error || 'read_failed')
        setContent(null)
        setReadComplete(true)
        return
      }
      const text = res.content ?? ''
      setContent(text)
      setLoadError(null)
      setReadComplete(maxBytes >= IPC_READ_MAX_BYTES || res.size == null || res.size <= maxBytes)
    },
    [readText, relativePath],
  )

  useEffect(() => {
    setContent(null)
    setLoadError(null)
    setReadComplete(true)
    setImageUrl(null)
    if (!relativePath || !mode) return

    let cancelled = false
    const isCancelled = () => cancelled

    const run = async () => {
      setLoading(true)
      if (mode === 'image') {
        const res = await ipcClient.invoke('shell.readImagePreview', { workspaceRoot, path: relativePath! })
        if (cancelled) return
        if (res?.ok && res.dataUrl) setImageUrl(res.dataUrl)
        else setLoadError(res?.error || 'preview_failed')
        setLoading(false)
        return
      }
      if (mode === 'binary' || mode === 'pdf') {
        setLoadError('binary')
        setLoading(false)
        return
      }
      await loadContent(PREVIEW_READ_MAX_BYTES, isCancelled)
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [relativePath, mode, readText, absPath, loadContent])

  useEffect(() => {
    if (refreshKey === 0 || !relativePath || !mode) return
    if (mode === 'image' || mode === 'binary' || mode === 'pdf') return
    let cancelled = false
    const run = async () => {
      const res = await readText(relativePath, { maxBytes: PREVIEW_READ_MAX_BYTES })
      if (cancelled) return
      if (!res.ok) {
        setLoadError(res.error || 'read_failed')
        setContent(null)
        return
      }
      setContent(res.content ?? '')
      setLoadError(null)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refreshKey, relativePath, mode, readText])

  const requestFullContent = useCallback(async () => {
    if (!relativePath) return null
    const res = await readText(relativePath, { maxBytes: IPC_READ_MAX_BYTES })
    if (!res.ok) {
      if (res.error === 'too_large') setLoadError('too_large')
      return null
    }
    const text = res.content ?? ''
    setContent(text)
    setReadComplete(true)
    setLoadError(null)
    return text
  }, [readText, relativePath])

  const wrap = (node: ReactNode, className?: string) => (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', fill && 'h-full w-full', className)}>{node}</div>
  )

  if (!relativePath) {
    return wrap(
      <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-[12px] text-foreground-secondary/80">
        {t('preview.pickFile')}
      </p>,
    )
  }

  if (loading) {
    return wrap(<p className="px-3 py-6 text-[12px] text-foreground-secondary/80">{t('preview.loading')}</p>)
  }

  if (loadError === 'binary' || loadError === 'too_large') {
    return wrap(
      <div className="space-y-3 px-3 py-4 text-[12px] text-foreground-secondary">
        <p>{loadError === 'too_large' ? t('preview.tooLarge') : mode === 'pdf' ? t('preview.pdf') : t('preview.binary')}</p>
        {loadError === 'too_large' ? (
          <button
            type="button"
            className="text-[12px] text-primary-semantic underline-offset-2 hover:underline"
            onClick={() => void requestFullContent().then((c) => c && setLoadError(null))}
          >
            {t('preview.tryExpandRead')}
          </button>
        ) : null}
        <button
          type="button"
          className="block text-[12px] text-primary-semantic underline-offset-2 hover:underline"
          onClick={() => void ipcClient.invoke('shell.openPath', { path: absPath })}
        >
          {t('preview.openInSystem')}
        </button>
      </div>,
    )
  }

  if (loadError === 'not_found') {
    return wrap(
      <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-[12px] text-foreground-secondary">
        {t('preview.deleted')}
      </p>,
    )
  }

  if (loadError) {
    return wrap(<p className="px-3 py-4 text-[12px] text-destructive">{t('preview.error')}</p>)
  }

  if (mode === 'image' && imageUrl) {
    return wrap(
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg-1)] p-0">
        <img src={imageUrl} alt="" className="max-h-full max-w-full object-contain" />
      </div>,
    )
  }

  if (mode === 'html' && content != null) {
    return wrap(
      <iframe
        title="html-preview"
        sandbox=""
        srcDoc={content}
        className="min-h-0 flex-1 border-0 bg-[var(--bg-base)]"
      />,
    )
  }

  if (mode === 'markdown' && content != null) {
    return wrap(
      <FilePreviewScroll scrollClassName="px-4 py-3 text-[13px]">
        <MarkdownView>{content}</MarkdownView>
      </FilePreviewScroll>,
      fill ? 'h-full' : undefined,
    )
  }

  if (mode === 'code' && content != null) {
    const lang = guessLangFromPath(relativePath)
    return wrap(
      <FileSourcePreview
        code={content}
        lang={lang}
        fill={fill}
        path={relativePath}
        readComplete={readComplete}
        onRequestFullContent={requestFullContent}
      />,
      'h-full',
    )
  }

  if ((mode === 'text' || mode === 'sheet') && content != null) {
    return wrap(<PlainTextFill content={content} />, 'h-full')
  }

  return null
}