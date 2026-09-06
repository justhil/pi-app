import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'

export type FilesCtxTarget = {
  x: number
  y: number
  abs: string
  name: string
  rel: string
  isDirectory: boolean
}

type Props = {
  menu: FilesCtxTarget | null
  onClose: () => void
  onPreview: () => void
  onAttach: () => void
  onCopyPath: () => void
  onCopyRel?: () => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onSearchInFolder?: () => void
  onRename: () => void
  onReveal: () => void
  onOpenInNewTab?: () => void
}

function clampMenuPosition(x: number, y: number, el: HTMLElement | null) {
  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = el?.offsetWidth ?? 200
  const h = el?.offsetHeight ?? 160
  return {
    left: Math.max(pad, Math.min(x, vw - w - pad)),
    top: Math.max(pad, Math.min(y, vh - h - pad)),
  }
}

export function FilesContextMenuPortal({
  menu,
  onClose,
  onPreview,
  onAttach,
  onCopyPath,
  onCopyRel,
  onNewFile,
  onNewFolder,
  onSearchInFolder,
  onRename,
  onReveal,
  onOpenInNewTab,
}: Props) {
  const { t } = useTranslation('files')
  const ref = useRef<HTMLDivElement>(null)

  useDismissContextMenu(!!menu, ref, onClose)

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const { left, top } = clampMenuPosition(menu.x, menu.y, ref.current)
    ref.current.style.left = `${left}px`
    ref.current.style.top = `${top}px`
  }, [menu])

  if (!menu) return null

  const item = contextMenuItemClass
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()

  return createPortal(
    <div
      ref={ref}
      className={contextMenuPanelClass}
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onPointerDown={stop}
    >
      {!menu.isDirectory ? (
        <button
          type="button"
          className={item}
          onPointerDown={stop}
          onClick={() => {
            onPreview()
            onClose()
          }}
        >
          {t('menu.preview')}
        </button>
      ) : null}
      {!menu.isDirectory && onOpenInNewTab ? (
        <button
          type="button"
          className={item}
          onPointerDown={stop}
          onClick={() => {
            onOpenInNewTab()
            onClose()
          }}
        >
          {t('menu.openInNewTab')}
        </button>
      ) : null}
      {!menu.isDirectory ? (
        <button
          type="button"
          className={item}
          onPointerDown={stop}
          onClick={() => {
            onAttach()
            onClose()
          }}
        >
          {t('menu.attach')}
        </button>
      ) : null}
      <button
        type="button"
        className={item}
        onPointerDown={stop}
        onClick={() => {
          onCopyPath()
          onClose()
        }}
      >
        {t('menu.copyPath')}
      </button>
      {onCopyRel ? (
        <button type="button" className={item} onPointerDown={stop} onClick={() => { onCopyRel(); onClose() }}>
          {t('menu.copyRel')}
        </button>
      ) : null}
      {menu.isDirectory && onNewFile ? (
        <button type="button" className={item} onPointerDown={stop} onClick={() => { onNewFile(); onClose() }}>
          {t('menu.newFile')}
        </button>
      ) : null}
      {menu.isDirectory && onNewFolder ? (
        <button type="button" className={item} onPointerDown={stop} onClick={() => { onNewFolder(); onClose() }}>
          {t('menu.newFolder')}
        </button>
      ) : null}
      {menu.isDirectory && onSearchInFolder ? (
        <button type="button" className={item} onPointerDown={stop} onClick={() => { onSearchInFolder(); onClose() }}>
          {t('menu.searchInFolder')}
        </button>
      ) : null}
      <button
        type="button"
        className={item}
        onPointerDown={stop}
        onClick={() => {
          onClose()
          onRename()
        }}
      >
        {t('menu.rename')}
      </button>
      <button
        type="button"
        className={item}
        onPointerDown={stop}
        onClick={() => {
          onReveal()
          onClose()
        }}
      >
        {t('menu.reveal')}
      </button>
    </div>,
    document.body,
  )
}