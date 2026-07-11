import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  AttachmentMeta,
  getAttachmentKind,
  resolveFilePath,
  basenameOf,
  insertAttachmentAtCursor,
} from './attachments'
import { readPiFilePathDrop } from '@renderer/features/workspace-files/workspace-files-types'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { insertTextAtCursor } from './composer-editor-caret'
import {
  extractDataUrlImageFromHtml,
  firstClipboardImageFile,
  isMeaningfulPlainPaste,
  normalizeClipboardImageMime,
  plainTextFromClipboardHtml,
} from './clipboard-paste-image'

export function useComposerAttachments(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  updateFromEditor: () => void
  canCompose: boolean
  canSendMessages: boolean
  currentWorkspace: string | null
  ephemeralSandboxDraft: boolean
  setIsDragActive: (v: boolean) => void
  dragDepth: React.MutableRefObject<number>
}) {
  const { t } = useTranslation()
  const {
    editorRef,
    updateFromEditor,
    canCompose,
    currentWorkspace,
    ephemeralSandboxDraft,
    setIsDragActive,
    dragDepth,
  } = opts

  const insertMetas = useCallback(
    (metas: AttachmentMeta[]) => {
      const el = editorRef.current
      if (!el || metas.length === 0) return
      el.focus()
      for (const m of metas) {
        insertAttachmentAtCursor(el, {
          ...m,
          chipId: m.chipId || `chip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        })
      }
      updateFromEditor()
    },
    [editorRef, updateFromEditor],
  )

  useEffect(() => {
    const onAttach = (e: Event) => {
      const detail = (e as CustomEvent<{ files?: { path: string; name: string; kind: string }[] }>).detail
      const files = detail?.files
      if (!files?.length) return
      const metas: AttachmentMeta[] = files.map((f) => ({
        path: f.path,
        name: f.name,
        kind: (f.kind as AttachmentMeta['kind']) || getAttachmentKind(f.name),
      }))
      insertMetas(metas)
    }
    window.addEventListener('pi-desktop:composer-attach-files', onAttach)
    return () => window.removeEventListener('pi-desktop:composer-attach-files', onAttach)
  }, [insertMetas])

  const insertPastedScreenshot = useCallback(
    async (base64: string, mimeType: string) => {
      if (!currentWorkspace && !ephemeralSandboxDraft) {
        toast.message(t('composer:toast.pasteScreenshotNeedWorkspace'))
        return
      }
      const mime = normalizeClipboardImageMime(mimeType)
      if (!mime) {
        toast.error(t('composer:toast.pasteScreenshotUnsupported'))
        return
      }
      try {
        const { path } = await ipcClient.invoke('clipboard.writeTempImage', {
          data: base64,
          mimeType: mime,
        })
        const ext =
          mime === 'image/jpeg'
            ? 'jpg'
            : mime === 'image/webp'
              ? 'webp'
              : mime === 'image/gif'
                ? 'gif'
                : mime === 'image/bmp'
                  ? 'bmp'
                  : 'png'
        const name = `clipboard-image-${Date.now()}.${ext}`
        const el = editorRef.current
        if (!el) return
        insertAttachmentAtCursor(el, { path, name, kind: 'image' })
        updateFromEditor()
      } catch (err) {
        console.error('clipboard.writeTempImage failed:', err)
        toast.error(t('composer:toast.pasteScreenshotFailed'))
      }
    },
    [currentWorkspace, editorRef, ephemeralSandboxDraft, t, updateFromEditor],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd) return
      const metas: AttachmentMeta[] = []
      const items = cd.items
      if (items) {
        for (const item of items) {
          if (item.kind !== 'file') continue
          const file = item.getAsFile()
          if (!file) continue
          const path = resolveFilePath(file)
          if (path) {
            const name = file.name || basenameOf(path)
            metas.push({ path, name, kind: getAttachmentKind(name) })
          }
        }
      }
      let pendingScreenshot = firstClipboardImageFile(cd)
      if (pendingScreenshot && resolveFilePath(pendingScreenshot)) {
        pendingScreenshot = null
      }
      const html = cd.getData('text/html')
      const htmlImage = extractDataUrlImageFromHtml(html)
      const plain = cd.getData('text/plain')
      const meaningfulPlain = isMeaningfulPlainPaste(plain)
      const stripHtmlOnly =
        !!html.trim() && !meaningfulPlain && !htmlImage && !metas.length && !pendingScreenshot
      const hasImagePaste = !!pendingScreenshot || !!htmlImage

      if (metas.length > 0 || hasImagePaste || meaningfulPlain || stripHtmlOnly) {
        e.preventDefault()
      }

      const insertPlainAfter = () => {
        if (!meaningfulPlain) return
        const el = editorRef.current
        if (el) insertTextAtCursor(el, plain)
        updateFromEditor()
      }

      if (metas.length > 0) {
        insertMetas(metas)
      }

      if (pendingScreenshot) {
        const file = pendingScreenshot
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          if (base64) {
            await insertPastedScreenshot(base64, file.type || 'image/png')
          }
          insertPlainAfter()
        }
        reader.onerror = () => {
          insertPlainAfter()
        }
        reader.readAsDataURL(file)
        return
      }

      if (htmlImage) {
        void insertPastedScreenshot(htmlImage.base64, htmlImage.mimeType).finally(() => {
          insertPlainAfter()
        })
        return
      }

      if (meaningfulPlain) {
        insertPlainAfter()
        return
      }

      if (stripHtmlOnly) {
        const text = plainTextFromClipboardHtml(html)
        if (!text.trim()) return
        const el = editorRef.current
        if (el) insertTextAtCursor(el, text)
        updateFromEditor()
      }
    },
    [editorRef, insertMetas, insertPastedScreenshot, updateFromEditor],
  )

  const addDroppedFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      if (files.length === 0) return
      const metas: AttachmentMeta[] = []
      const seen = new Set<string>()
      for (const f of files) {
        const path = resolveFilePath(f)
        if (!path) continue
        if (seen.has(path)) continue
        seen.add(path)
        const name = f.name || basenameOf(path)
        metas.push({ path, name, kind: getAttachmentKind(name) })
      }
      insertMetas(metas)
    },
    [insertMetas],
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      const dt = e.dataTransfer
      if (!dt?.types?.includes('Files') && !dt?.types?.includes('application/x-pi-file-path')) return
      e.preventDefault()
      dragDepth.current += 1
      setIsDragActive(true)
    },
    [dragDepth, setIsDragActive],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current -= 1
      if (dragDepth.current <= 0) {
        dragDepth.current = 0
        setIsDragActive(false)
      }
    },
    [dragDepth, setIsDragActive],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const dt = e.dataTransfer
    if (dt?.types?.includes('Files') || dt?.types?.includes('application/x-pi-file-path')) e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const dt = e.dataTransfer
      const pi = dt ? readPiFilePathDrop(dt) : null
      if (pi) {
        e.preventDefault()
        dragDepth.current = 0
        setIsDragActive(false)
        insertMetas([{ path: pi.path, name: pi.name, kind: getAttachmentKind(pi.name) }])
        return
      }
      if (!dt?.files?.length) return
      e.preventDefault()
      dragDepth.current = 0
      setIsDragActive(false)
      addDroppedFiles(dt.files)
    },
    [addDroppedFiles, dragDepth, insertMetas, setIsDragActive],
  )

  const removeAttachment = useCallback(
    (meta: AttachmentMeta) => {
      hideAllDelayedTooltips()
      const el = editorRef.current
      if (!el) return
      let chip: HTMLElement | null = null
      if (meta.chipId) {
        chip = el.querySelector(
          `[data-attachment-chip-id="${CSS.escape(meta.chipId)}"]`,
        ) as HTMLElement | null
      }
      if (!chip) {
        const candidates = el.querySelectorAll(
          `[data-attachment-path="${CSS.escape(meta.path)}"]`,
        )
        for (const node of candidates) {
          const element = node as HTMLElement
          const kind = element.dataset.attachmentKind || 'file'
          if (kind !== meta.kind) continue
          if (meta.kind === 'line-ref') {
            if (element.dataset.attachmentLine !== String(meta.line ?? '')) continue
            if ((element.dataset.attachmentEndLine || '') !== String(meta.endLine ?? '')) continue
          }
          chip = element
          break
        }
      }
      if (!chip) return
      const prev = chip.previousSibling
      const next = chip.nextSibling
      if (prev && prev.nodeType === Node.TEXT_NODE && (prev.nodeValue || '') === '\u200B') {
        prev.parentNode?.removeChild(prev)
      }
      if (next && next.nodeType === Node.TEXT_NODE && (next.nodeValue || '') === '\u200B') {
        next.parentNode?.removeChild(next)
      }
      chip.parentNode?.removeChild(chip)
      el.normalize()
      updateFromEditor()
    },
    [editorRef, updateFromEditor],
  )

  const pickAttachments = useCallback(async () => {
    if (!canCompose) return
    try {
      const res = await ipcClient.invoke('dialog:openFiles', { multiple: true })
      const paths = (res?.paths || []) as string[]
      if (paths.length === 0) return
      const metas: AttachmentMeta[] = []
      const seen = new Set<string>()
      for (const path of paths) {
        if (!path || seen.has(path)) continue
        seen.add(path)
        const name = basenameOf(path)
        metas.push({ path, name, kind: getAttachmentKind(name) })
      }
      insertMetas(metas)
    } catch (e) {
      console.error('pick attachments failed', e)
    }
  }, [canCompose, insertMetas])

  return {
    handlePaste,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    removeAttachment,
    pickAttachments,
  }
}