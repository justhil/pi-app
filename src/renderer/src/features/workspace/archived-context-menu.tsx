import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from '@renderer/components/icons'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'

export type ArchivedMenuTarget = {
  sessionId: string
  sessionFile?: string
  title?: string
  workspacePath: string
}

export type ArchivedGroupMenu = {
  x: number
  y: number
  kind: 'project' | 'sandbox'
  workspacePath: string
  label: string
}

/**
 * 已归档相关右键菜单：
 * - menu：单个已归档条目的菜单（恢复 / 删除）
 * - groupMenu：已归档分组头部的菜单（批量取消归档…）
 */
export function ArchivedContextMenuPortal({
  menu,
  groupMenu,
  onClose,
  onRestore,
  onDelete,
  onBatchRestore,
}: {
  menu: { x: number; y: number; target: ArchivedMenuTarget } | null
  groupMenu: ArchivedGroupMenu | null
  onClose: () => void
  onRestore: (target: ArchivedMenuTarget) => void
  onDelete: (target: ArchivedMenuTarget) => void
  onBatchRestore: (group: ArchivedGroupMenu) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  useDismissContextMenu(!!menu || !!groupMenu, ref, onClose)

  if (!menu && !groupMenu) return null

  return createPortal(
    <div
      ref={ref}
      className={contextMenuPanelClass}
      style={{ left: (menu ?? groupMenu)!.x, top: (menu ?? groupMenu)!.y }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {groupMenu && (
        <button
          type="button"
          className={contextMenuItemClass}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onBatchRestore(groupMenu)
            onClose()
          }}
        >
          <RotateCcw className="h-3 w-3 shrink-0" strokeWidth={2} />
          {t('common:sidebar.batchRestoreMenu')}
        </button>
      )}
      {menu && (
        <>
          <button
            type="button"
            className={contextMenuItemClass}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onRestore(menu.target)
              onClose()
            }}
          >
            <RotateCcw className="h-3 w-3 shrink-0" strokeWidth={2} />
            {t('common:sidebar.restore')}
          </button>
          <button
            type="button"
            className={contextMenuDangerItemClass}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(menu.target)
              onClose()
            }}
          >
            <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
            {t('common:sidebar.delete')}
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
