import { memo } from 'react'
import { X } from 'lucide-react'
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
}: {
  attachment: AttachmentMeta
  onRemove?: () => void
  className?: string
  /** Clickable chips open files with system default app */
  openable?: boolean
}) {
  const { t } = useTranslation()
  const Icon = getAttachmentIcon(attachment.kind)
  const handleOpen = () => {
    void ipcClient.invoke('shell.openPath', { path: attachment.path })
  }

  const chip = (
    <span
      className={cn(
        'attachment-chip inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-[var(--bg-2)]/85 px-2.5 py-1.5 text-[12px] leading-tight text-foreground-secondary',
        openable && 'cursor-pointer',
        className,
      )}
      onClick={openable ? handleOpen : undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-65" strokeWidth={2} />
      <span className="max-w-[220px] truncate font-mono text-[12px]">{attachment.name}</span>
      {onRemove && (
        <button
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); hideAllDelayedTooltips() }}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="attachment-chip-remove -mr-0.5 rounded p-0.5 opacity-45"
          aria-label={t('composer:removeFile')}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )

  return (
    <DelayedTooltip content={attachment.path}>
      {chip}
    </DelayedTooltip>
  )
}

export const AttachmentChip = memo(AttachmentChipImpl)