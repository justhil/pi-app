import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Columns2,
  Copy,
  FolderOpen,
  GitFork,
  Pencil,
  Play,
  Terminal,
  Trash2,
} from '@renderer/components/icons'
import { requestOpenInPane } from '@renderer/features/split/split-dnd'
import { openTerminalTab } from '@renderer/features/terminal/terminal-drawer'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  SessionPinGlyph,
  isSessionPinned,
  toggleSessionPinned,
} from '@renderer/lib/pinned-sessions'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathsEqual } from '@shared/workspace-path'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { SessionForkSubmenu } from './session-fork-submenu'
import type { SandboxMenuTarget } from './use-sandbox-context-menu'

type MenuState = { x: number; y: number; target: SandboxMenuTarget } | null
type RenameState = { path: string; label: string } | null

/**
 * Full-featured right-click menu for non-project (Temporary / Sandbox) conversations:
 * Pin/Unpin, Continue, Open in Split Pane, Fork Submenu, Open Terminal in Sandbox,
 * Copy Session Path, Reveal Log File, Rename, and Delete.
 */
export function SandboxContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const pinnedSessions = useUIStore((s) => s.pinnedSessions)
  const [renameState, setRenameState] = useState<RenameState>(null)
  const [deleteState, setDeleteState] = useState<{ path: string; label: string; sessionFile?: string } | null>(null)
  const [forkAnchor, setForkAnchor] = useState<DOMRect | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)
  useEffect(() => setForkAnchor(null), [menu])

  const submitRename = async (label: string) => {
    const state = renameState
    if (!state) return
    try {
      const r = await ipcClient.invoke('workspace.sandbox.rename', {
        path: state.path,
        label,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.renamed'))
        onListChange()
        setRenameState(null)
      } else toast.error(r?.error || t('common:sidebar.renameFailed'))
    } catch {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const runDelete = async (target: { path: string; sessionFile?: string }) => {
    try {
      const r = await ipcClient.invoke('workspace.sandbox.delete', { path: target.path })
      if (r?.ok) {
        if (target.sessionFile && isSessionPinned(useUIStore.getState().pinnedSessions, target.sessionFile)) {
          toggleSessionPinned(target.sessionFile)
        }
        const cur = useUIStore.getState().currentWorkspace
        if (cur === target.path) {
          useUIStore.getState().setWorkspace(null)
          useUIStore.getState().clearTimeline()
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
        }
        toast.success(t('common:sidebar.deleted'))
        onListChange()
      } else toast.error(r?.error || t('common:sidebar.deleteFailed'))
    } catch {
      toast.error(t('common:sidebar.deleteFailed'))
    }
  }

  const itemClass = contextMenuItemClass
  const target = menu?.target
  const hasSession = Boolean(target?.sessionFile && target?.sessionId)
  const pinned = isSessionPinned(pinnedSessions, target?.sessionFile)

  return (
    <>
      {menu && target
        ? createPortal(
            <div ref={ref}>
              <div
                className={contextMenuPanelClass}
                style={{ left: menu.x, top: menu.y }}
                role="menu"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerOver={(e) => {
                  if (!(e.target as HTMLElement).closest('[data-fork-item]')) setForkAnchor(null)
                }}
              >
                {target.sessionFile ? (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      const nowPinned = toggleSessionPinned({
                        sessionFile: target.sessionFile!,
                        sessionId: target.sessionId,
                        workspacePath: target.path,
                        title: target.label || t('common:sidebar.tempChat'),
                        kind: 'sandbox',
                      })
                      toast.success(nowPinned ? t('common:sidebar.pinned') : t('common:sidebar.unpinned'))
                      onClose()
                    }}
                  >
                    <SessionPinGlyph className="h-3 w-3 shrink-0" />
                    {pinned ? t('common:sidebar.unpinSession') : t('common:sidebar.pinSession')}
                  </button>
                ) : null}

                {hasSession &&
                selectSessionAttention(target.sessionFile!, useUIStore.getState().sessionAttention) !== 'working' ? (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      const currentWorkspace = useUIStore.getState().currentWorkspace
                      if (workspacePathsEqual(target.path, currentWorkspace)) {
                        void switchSessionInPlace(target.sessionId!, target.sessionFile!)
                      } else {
                        void activateWorkspace(target.path, {
                          sessionId: target.sessionId!,
                          sessionFile: target.sessionFile!,
                        })
                      }
                      onClose()
                    }}
                  >
                    <Play className="h-3 w-3 shrink-0" strokeWidth={2} />
                    {t('common:sidebar.continue')}
                  </button>
                ) : null}

                {hasSession ? (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      requestOpenInPane({
                        sessionId: target.sessionId!,
                        sessionFile: target.sessionFile!,
                        workspace: target.path,
                        title: target.label || t('common:sidebar.tempChat'),
                      })
                      onClose()
                    }}
                  >
                    <Columns2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                    {t('common:split.openInPane')}
                  </button>
                ) : null}

                {hasSession ? (
                  <button
                    type="button"
                    className={itemClass}
                    data-fork-item
                    aria-haspopup="menu"
                    aria-expanded={!!forkAnchor}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerEnter={(e) => setForkAnchor(e.currentTarget.getBoundingClientRect())}
                    onClick={(e) => {
                      e.stopPropagation()
                      setForkAnchor(e.currentTarget.getBoundingClientRect())
                    }}
                  >
                    <GitFork className="h-3 w-3 shrink-0" strokeWidth={2} />
                    {t('common:sidebar.fork')}
                    <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-foreground-secondary" strokeWidth={2} />
                  </button>
                ) : null}

                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void openTerminalTab(undefined, target.path)
                    onClose()
                  }}
                >
                  <Terminal className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.openInTerminal')}
                </button>

                {target.sessionFile ? (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void navigator.clipboard.writeText(target.sessionFile || '')
                      toast.success(t('files:toast.copied'))
                      onClose()
                    }}
                  >
                    <Copy className="h-3 w-3 shrink-0" strokeWidth={2} />
                    {t('common:sidebar.copySessionPath')}
                  </button>
                ) : null}

                {target.sessionFile ? (
                  <button
                    type="button"
                    className={itemClass}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void ipcClient.invoke('shell.showItemInFolder', { path: target.sessionFile })
                      onClose()
                    }}
                  >
                    <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
                    {t('common:sidebar.openLog')}
                  </button>
                ) : null}

                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenameState({ path: target.path, label: target.label })
                    onClose()
                  }}
                >
                  <Pencil className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.rename')}
                </button>

                <button
                  type="button"
                  className={contextMenuDangerItemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteState({ path: target.path, label: target.label, sessionFile: target.sessionFile })
                    onClose()
                  }}
                >
                  <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.delete')}
                </button>
              </div>

              {forkAnchor && hasSession ? (
                <SessionForkSubmenu
                  anchor={forkAnchor}
                  target={{
                    sessionId: target.sessionId!,
                    sessionFile: target.sessionFile!,
                    title: target.label || t('common:sidebar.tempChat'),
                    workspacePath: target.path,
                  }}
                  onDone={onClose}
                  onSessionsChange={onListChange}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}

      <RenamePromptDialog
        open={!!renameState}
        title={t('common:sidebar.renameTempChat')}
        defaultValue={renameState?.label ?? ''}
        onConfirm={submitRename}
        onCancel={() => setRenameState(null)}
      />
      <ConfirmDialog
        open={!!deleteState}
        title={t('common:sidebar.delete')}
        message={t('common:sidebar.deleteConfirm', { name: deleteState?.label ?? '' })}
        destructive
        onConfirm={() => {
          const item = deleteState
          setDeleteState(null)
          if (item) void runDelete(item)
        }}
        onCancel={() => setDeleteState(null)}
      />
    </>
  )
}
