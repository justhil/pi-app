import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { CodeBlockView } from '@renderer/features/timeline/code-block-view'
import { guessLangFromPath } from '@renderer/lib/shiki-highlighter'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { joinWorkspacePath } from './path-utils'
import { resolveFilePreviewMode } from './file-preview-mode'
import {
  PREVIEW_HTML_MAX_CHARS,
  PREVIEW_MD_MAX_CHARS,
  PREVIEW_MD_MAX_LINES,
  PREVIEW_PLAIN_MAX_LINES,
  PREVIEW_SHIKI_MAX_CHARS,
} from './file-preview-limits'

function sliceLines(text: string, maxLines: number) {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { text, truncated: false }
  return { text: lines.slice(0, maxLines).join('\n') + '\n…', truncated: true }
}

function PlainTextPreview({ content, note }: { content: string; note?: string }) {
  const { text, truncated } = sliceLines(content, PREVIEW_PLAIN_MAX_LINES)
  return (
    <div>
      {note ? <p className="mb-2 text-[11px] text-foreground-secondary/80">{note}</p> : null}
      {truncated ? <p className="mb-2 text-[11px] text-foreground-secondary/80">…</p> : null}
      <pre className="native-code-shiki max-h-[min(70vh,480px)] overflow-auto rounded-lg border border-border/60 bg-[var(--code-bg)] p-3 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  )
}

export function FilePreviewRouter({
  workspaceRoot,
  relativePath,
  readText,
}: {
  workspaceRoot: string
  relativePath: string | null
  readText: (p: string) => Promise<{ ok: boolean; content?: string; error?: string }>
}) {
  const { t } = useTranslation('files')
  const [content, setContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const mode = useMemo(
    () => (relativePath ? resolveFilePreviewMode(relativePath) : null),
    [relativePath],
  )

  const absPath = relativePath ? joinWorkspacePath(workspaceRoot, relativePath) : ''

  useEffect(() => {
    setContent(null)
    setLoadError(null)
    setImageUrl(null)
    if (!relativePath || !mode) return

    let cancelled = false
    const run = async () => {
      setLoading(true)
      if (mode === 'image') {
        const res = await ipcClient.invoke('shell.readImagePreview', { path: absPath })
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
      const res = await readText(relativePath)
      if (cancelled) return
      if (!res.ok) {
        setLoadError(res.error || 'read_failed')
        setLoading(false)
        return
      }
      setContent(res.content ?? '')
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [relativePath, mode, readText, absPath])

  if (!relativePath) {
    return (
      <p className="px-1 py-8 text-center text-[12px] text-foreground-secondary/80">{t('preview.pickFile')}</p>
    )
  }

  if (loading) {
    return <p className="px-1 py-6 text-[12px] text-foreground-secondary/80">{t('preview.loading')}</p>
  }

  if (loadError === 'binary' || loadError === 'too_large') {
    return (
      <div className="space-y-3 px-1 py-4 text-[12px] text-foreground-secondary">
        <p>{loadError === 'too_large' ? t('preview.tooLarge') : mode === 'pdf' ? t('preview.pdf') : t('preview.binary')}</p>
        <button
          type="button"
          className="text-[12px] text-primary-semantic underline-offset-2 hover:underline"
          onClick={() => void ipcClient.invoke('shell.openPath', { path: absPath })}
        >
          {t('preview.openInSystem')}
        </button>
      </div>
    )
  }

  if (loadError) {
    return <p className="px-1 py-4 text-[12px] text-destructive">{t('preview.error')}</p>
  }

  if (mode === 'image' && imageUrl) {
    return (
      <div className="flex min-h-[min(100%,320px)] flex-1 flex-col items-center justify-center py-4">
        <img
          src={imageUrl}
          alt=""
          className="max-h-[min(70vh,100%)] max-w-full rounded-lg border border-border/60 object-contain"
        />
      </div>
    )
  }

  if (mode === 'html' && content != null) {
    const html = content.length > PREVIEW_HTML_MAX_CHARS ? content.slice(0, PREVIEW_HTML_MAX_CHARS) : content
    return (
      <iframe
        title="html-preview"
        sandbox=""
        srcDoc={html}
        className={cn('h-full min-h-[280px] max-h-[min(70vh,560px)] w-full rounded-lg border border-border/60 bg-white dark:bg-[var(--bg-1)]')}
      />
    )
  }

  if (mode === 'markdown' && content != null) {
    if (content.length > PREVIEW_MD_MAX_CHARS) {
      const { text } = sliceLines(content, PREVIEW_MD_MAX_LINES)
      return <PlainTextPreview content={text} note={t('preview.truncated')} />
    }
    return (
      <div className="min-w-0 max-h-[min(70vh,560px)] overflow-auto text-[13px]">
        <MarkdownView>{content}</MarkdownView>
      </div>
    )
  }

  if (mode === 'code' && content != null) {
    if (content.length > PREVIEW_SHIKI_MAX_CHARS) {
      return <PlainTextPreview content={content} note={t('preview.truncatedNoHighlight')} />
    }
    const lang = guessLangFromPath(relativePath)
    return (
      <CodeBlockView code={content} lang={lang} previewLines={24} defaultExpanded={false} maxHeightExpanded="max-h-[min(70vh,480px)]" />
    )
  }

  if ((mode === 'text' || mode === 'sheet') && content != null) {
    return <PlainTextPreview content={content} />
  }

  return null
}