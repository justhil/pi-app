import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'

/**
 * Full-window image preview for staged composer images. Lives outside the editor, so it
 * never touches the contenteditable DOM or its native undo stack.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string | null; alt?: string; onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase + stopPropagation: keep Escape away from composer/dialog handlers.
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [src, onClose])

  if (!src) return null

  return createPortal(
    <div
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t('composer:previewImage')}
    >
      <img
        src={src}
        alt={alt ?? ''}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        draggable={false}
      />
      {/* Theme tokens, not fixed black/white: custom and imported themes set their own palette. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('composer:closePreview')}
        className="absolute right-4 top-4 rounded-full border border-border bg-background/95 p-2 text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  )
}
