import { memo } from 'react'
import { X } from '@renderer/components/icons'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { getAttachmentIcon, type AttachmentMeta } from './attachments'
import { ipcClient } from '@renderer/lib/ipc-client'
import { DelayedTooltip, hideAllDelayedTooltips } from './delayed-tooltip'

function AttachmentChipImpl({
  attachment,
  onRemove,
  className,
  openable = false,
  previewSrc,
  onPreview,
}: {
  attachment: AttachmentMeta
  onRemove?: () => void
  className?: string
  /** Clickable chips open files with system default app */
  openable?: boolean
  /** 图片 chip：缩略图 data URL（暂存图片专用，不写编辑器） */
  previewSrc?: string
  /** 点击缩略图放大预览 */
  onPreview?: () => void
}) {
  const { t } = useTranslation()
  const Icon = getAttachmentIcon(attachment.kind)
  const isLineRef = attachment.kind === 'line-ref'
  const isThumb = attachment.kind === 'image' && !!previewSrc
  const handleOpen = () => {
    if (isLineRef) {
      // Open file in Files panel when possible
      void import('@renderer/lib/open-workspace-path').then(({ openWorkspaceRelativePath }) => {
        openWorkspaceRelativePath(attachment.path)
      })
      return
    }
    void ipcClient.invoke('shell.openPath', { path: attachment.path })
  }

  const tooltip = isLineRef
    ? `${attachment.path}:${attachment.line ?? ''}${attachment.snippet ? `\n${attachment.snippet}` : ''}`
    : attachment.path

  if (isThumb) {
    return (
      <DelayedTooltip content={tooltip}>
        {/* Outer span stays unclipped so the remove badge can overhang the tile corner. */}
        <span className={cn('attachment-chip attachment-chip--thumb relative inline-flex h-16 w-16 shrink-0', className)}>
          <span className="attachment-thumb-frame block h-full w-full overflow-hidden rounded-md">
            <button
              type="button"
              onClick={onPreview}
              aria-label={t('composer:previewImage')}
              className="attachment-thumb-open flex h-full w-full cursor-zoom-in items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            >
              <img
                src={previewSrc}
                alt={attachment.name}
                draggable={false}
                className="pointer-events-none h-full w-full object-cover"
              />
            </button>
          </span>
          {onRemove && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation()
                hideAllDelayedTooltips()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="attachment-chip-remove attachment-chip-remove--thumb absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-[var(--bg-1)] p-0 text-foreground-secondary shadow-sm"
              aria-label={t('composer:removeFile')}
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          )}
        </span>
      </DelayedTooltip>
    )
  }

  const chip = (
    <span
      className={cn(
        'attachment-chip inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-[var(--bg-2)]/85 px-2.5 py-1.5 text-[12px] leading-tight text-foreground-secondary',
        isLineRef && 'attachment-chip--line-ref border-primary/25 bg-primary/[0.06]',
        (openable || isLineRef) && 'cursor-pointer',
        className,
      )}
      onClick={openable || isLineRef ? handleOpen : undefined}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0 opacity-65', isLineRef && 'text-primary/80')} strokeWidth={2} />
      <span className="max-w-[220px] truncate font-mono text-[12px]">{attachment.name}</span>
      {onRemove && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation()
            hideAllDelayedTooltips()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="attachment-chip-remove -mr-0.5 rounded p-0.5 opacity-45"
          aria-label={t('composer:removeFile')}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )

  return (
    <DelayedTooltip content={tooltip}>
      {chip}
    </DelayedTooltip>
  )
}

export const AttachmentChip = memo(AttachmentChipImpl)