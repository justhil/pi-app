import { type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

/** 列分界拖拽：无悬停高亮，右栏手柄对齐 grid 接缝（主对话区右缘） */
export function PanelResizeEdge({
  side,
  dragging,
  onMouseDown,
}: {
  side: 'left' | 'right'
  dragging: boolean
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={t('common:window.dragResizeWidth')}
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(e)
      }}
      className={cn(
        'panel-resize-edge electron-no-drag z-[60] cursor-col-resize',
        side === 'left' && 'panel-resize-edge--left shrink-0 self-stretch',
        side === 'right' && 'panel-resize-edge--right',
        dragging && 'panel-resize-edge--dragging',
      )}
    />
  )
}