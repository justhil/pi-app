import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  AttachmentMeta,
  getAttachmentKind,
  resolveFilePath,
  basenameOf,
  imageMimeFromName,
  insertAttachmentAtCursor,
  readFileAsDataUrl,
  type StagedImage,
} from './attachments'
import { readPiFilePathDrop } from '@renderer/features/workspace-files/workspace-files-types'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { insertTextAtCursor } from './composer-editor-caret'
import {
  extractDataUrlImageFromHtml,
  firstClipboardImageFile,
  isMeaningfulPlainPaste,
  normalizeClipboardImageMime,
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
  /** 暂存一张图片（不进编辑器，见 attachments.tsx 的 StagedImage 注释）。 */
  stageImage: (image: StagedImage) => void
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
    stageImage,
  } = opts

  /** 图片文件：先占位（图标），读完后补上缩略图 data URL。 */
  const stageImageFile = useCallback(
    (file: File, path: string, name: string) => {
      const mimeType = normalizeClipboardImageMime(file.type) ?? imageMimeFromName(name)
      stageImage({ path, name, mimeType })
      void readFileAsDataUrl(file)
        .then((dataUrl) => stageImage({ path, name, mimeType, dataUrl }))
        .catch(() => {
          /* 缩略图失败时保留图标 chip，不影响发送 */
        })
    },
    [stageImage],
  )

  /** 只有路径的图片（文件选择器/浏览器注解）：缩略图仅对工作区内文件可用，失败保留图标。 */
  const stageImagePath = useCallback(
    (path: string, name: string) => {
      const mimeType = imageMimeFromName(name)
      stageImage({ path, name, mimeType })
      if (!currentWorkspace) return
      void ipcClient
        .invoke('shell.readImagePreview', { workspaceRoot: currentWorkspace, path })
        .then((res) => {
          if (res?.dataUrl) stageImage({ path, name, mimeType, dataUrl: res.dataUrl })
        })
        .catch(() => {
          /* 保留图标 chip */
        })
    },
    [currentWorkspace, stageImage],
  )

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
      // `text` (optional) is inserted before the files, e.g. browser annotations or page logs.
      const detail = (e as CustomEvent<{ files?: { path: string; name: string; kind: string }[]; text?: string }>).detail
      const files = detail?.files ?? []
      const text = typeof detail?.text === 'string' ? detail.text : ''
      if (!files.length && !text) return
      const el = editorRef.current
      if (text && el) {
        insertTextAtCursor(el, text.endsWith('\n') ? text : `${text}\n`)
        updateFromEditor()
      }
      for (const f of files) {
        const kind = (f.kind as AttachmentMeta['kind']) || getAttachmentKind(f.name)
        if (kind === 'image') stageImagePath(f.path, f.name)
      }
      const metas: AttachmentMeta[] = files
        .filter((f) => ((f.kind as AttachmentMeta['kind']) || getAttachmentKind(f.name)) !== 'image')
        .map((f) => ({
          path: f.path,
          name: f.name,
          kind: (f.kind as AttachmentMeta['kind']) || getAttachmentKind(f.name),
        }))
      insertMetas(metas)
    }
    window.addEventListener('pi-desktop:composer-attach-files', onAttach)
    return () => window.removeEventListener('pi-desktop:composer-attach-files', onAttach)
  }, [editorRef, insertMetas, stageImagePath, updateFromEditor])

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
        // 图片暂存到附件条：不写编辑器 DOM，原生撤销栈不受影响。
        stageImage({ path, name, mimeType: mime, dataUrl: `data:${mime};base64,${base64}` })
      } catch (err) {
        console.error('clipboard.writeTempImage failed:', err)
        toast.error(t('composer:toast.pasteScreenshotFailed'))
      }
    },
    [currentWorkspace, ephemeralSandboxDraft, stageImage, t],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd) return
      const metas: AttachmentMeta[] = []
      let stagedAny = false
      const items = cd.items
      if (items) {
        for (const item of items) {
          if (item.kind !== 'file') continue
          const file = item.getAsFile()
          if (!file) continue
          const path = resolveFilePath(file)
          if (path) {
            const name = file.name || basenameOf(path)
            const kind = getAttachmentKind(name)
            if (kind === 'image') {
              stageImageFile(file, path, name)
              stagedAny = true
            } else {
              metas.push({ path, name, kind })
            }
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
      const hasFilesOrImages =
        metas.length > 0 || stagedAny || !!pendingScreenshot || !!htmlImage
      if (!hasFilesOrImages) {
        const el = editorRef.current
        if (el && html && el.contentEditable === 'true') {
          // Use the browser's plain-text paste to discard webpage HTML whitespace without
          // touching content or the undo stack. Restore rich editing in the next task, after
          // the default paste action, so attachment chips remain supported.
          el.contentEditable = 'plaintext-only'
          window.setTimeout(() => {
            if (el.contentEditable === 'plaintext-only') el.contentEditable = 'true'
          }, 0)
        }
        return
      }
      e.preventDefault()

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
    },
    [editorRef, insertMetas, insertPastedScreenshot, stageImageFile, updateFromEditor],
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
        const kind = getAttachmentKind(name)
        if (kind === 'image') stageImageFile(f, path, name)
        else metas.push({ path, name, kind })
      }
      insertMetas(metas)
    },
    [insertMetas, stageImageFile],
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
        const kind = getAttachmentKind(name)
        if (kind === 'image') stageImagePath(path, name)
        else metas.push({ path, name, kind })
      }
      insertMetas(metas)
    } catch (e) {
      console.error('pick attachments failed', e)
    }
  }, [canCompose, insertMetas, stageImagePath])

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