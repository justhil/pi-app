import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Minus, Search } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { useEditorStore } from '@renderer/stores/editor-store'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { getAttachmentKind } from '@renderer/features/composer/attachments'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { useWorkspaceFs } from './use-workspace-fs'
import { FileTree } from './file-tree'
import { FilesContextMenuPortal, type FilesCtxTarget } from './files-context-menu-portal'
import { RenamePromptDialog } from '@renderer/features/workspace/rename-prompt-dialog'

type RenameTarget = Pick<FilesCtxTarget, 'abs' | 'name' | 'rel'>

/** Files explorer. Tree only — opening a file puts a tab in the main-column editor. */
export function WorkspaceFilesPanel() {
  const { t } = useTranslation('files')
  const panelRef = useRef<HTMLDivElement>(null)
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  // Hidden files are part of the tree by default; the eye button hides them.
  const [showDotfiles, setShowDotfiles] = useState(true)
  const { listDir } = useWorkspaceFs(workspaceRoot, showDotfiles)
  const activeDoc = useEditorStore((s) => s.docs.find((d) => d.id === s.activeId) ?? null)
  const [searchQuery, setSearchQuery] = useState('')
  const [treeEpoch, setTreeEpoch] = useState(0)
  const [collapseEpoch, setCollapseEpoch] = useState(0)
  const [menu, setMenu] = useState<FilesCtxTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [createTarget, setCreateTarget] = useState<{ rel: string; isDirectory: boolean } | null>(null)

  const selectedPath = activeDoc?.workspace === workspaceRoot ? activeDoc.rel : null

  const onSelectPath = useCallback(
    (rel: string, isDirectory: boolean) => {
      if (isDirectory || !workspaceRoot) return
      const name = rel.split('/').pop() || rel
      useEditorStore.getState().open({ workspace: workspaceRoot, rel, name })
    },
    [workspaceRoot],
  )

  const attachToComposer = useCallback(
    (abs: string, name: string) => {
      const kind = getAttachmentKind(name)
      window.dispatchEvent(
        new CustomEvent('pi-desktop:composer-attach-files', {
          detail: { files: [{ path: abs, name, kind }] },
        }),
      )
      toast.message(t('toast.attached'))
    },
    [t],
  )

  const onContextMenuEntry = useCallback(
    (e: React.MouseEvent, abs: string, name: string, rel: string, isDirectory: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, abs, name, rel, isDirectory })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])
  const bumpTree = () => setTreeEpoch((n) => n + 1)

  const submitRename = async () => {
    if (!workspaceRoot || !renameTarget) return
    const name = renameValue.trim()
    if (!name) return
    const res = await ipcClient.invoke('workspace.fs.rename', {
      workspaceRoot,
      relativePath: renameTarget.rel,
      newName: name,
    })
    setRenameOpen(false)
    setRenameTarget(null)
    if (!res?.ok) {
      toast.error(t('toast.renameFailed'))
      return
    }
    useEditorStore.getState().renameRel(renameTarget.rel, res.newRelativePath as string, name)
    bumpTree()
    toast.message(t('toast.renamed'))
  }

  useEffect(() => {
    if (!workspaceRoot) return
    setTreeEpoch((n) => n + 1)
  }, [workspaceRoot])

  if (!workspaceRoot) {
    return <p className="px-4 py-8 text-center text-[12px] text-foreground-secondary/80">{t('empty.noWorkspace')}</p>
  }

  return (
    <div ref={panelRef} className="workspace-files-panel flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="files-explorer-toolbar flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-2 py-2">
          <div className="workbench-search files-search min-w-0 flex-1">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              className="w-full"
            />
          </div>
          <button
            type="button"
            title={t(showDotfiles ? 'tree.dotfilesHide' : 'tree.dotfiles')}
            aria-label={t(showDotfiles ? 'tree.dotfilesHide' : 'tree.dotfiles')}
            aria-pressed={showDotfiles}
            className="workbench-icon"
            onClick={() => setShowDotfiles((v) => !v)}
          >
            {showDotfiles ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            title={t('tree.collapseAll')}
            aria-label={t('tree.collapseAll')}
            className="workbench-icon"
            onClick={() => setCollapseEpoch((n) => n + 1)}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
        <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-1.5 pb-2">
          <FileTree
            key={treeEpoch}
            workspaceRoot={workspaceRoot}
            listDir={listDir}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            searchQuery={searchQuery}
            collapseEpoch={collapseEpoch}
            onContextMenuEntry={onContextMenuEntry}
          />
        </OverlayScrollHost>
      </div>

      <FilesContextMenuPortal
        menu={menu}
        onClose={closeMenu}
        onPreview={() => {
          if (!menu || menu.isDirectory) return
          onSelectPath(menu.rel, false)
        }}
        onOpenInNewTab={() => {
          if (!menu || menu.isDirectory) return
          onSelectPath(menu.rel, false)
        }}
        onAttach={() => {
          if (!menu) return
          attachToComposer(menu.abs, menu.name)
        }}
        onCopyPath={() => {
          if (!menu) return
          void navigator.clipboard.writeText(menu.abs)
          toast.message(t('toast.copied'))
        }}
        onCopyRel={() => {
          if (!menu) return
          void navigator.clipboard.writeText(menu.rel)
          toast.message(t('toast.copied'))
        }}
        onNewFile={() => {
          if (!menu) return
          setCreateTarget({ rel: menu.rel, isDirectory: false })
        }}
        onNewFolder={() => {
          if (!menu) return
          setCreateTarget({ rel: menu.rel, isDirectory: true })
        }}
        onSearchInFolder={() => {
          if (!menu) return
          setSearchQuery(`${menu.rel.replace(/\\/g, '/')}/`)
        }}
        onRename={() => {
          if (!menu) return
          setRenameTarget({ abs: menu.abs, name: menu.name, rel: menu.rel })
          setRenameValue(menu.name)
          setRenameOpen(true)
        }}
        onReveal={() => {
          if (!menu) return
          void ipcClient.invoke('shell.showItemInFolder', { path: menu.abs })
        }}
      />

      <RenamePromptDialog
        open={!!createTarget}
        title={createTarget?.isDirectory ? t('menu.newFolder') : t('menu.newFile')}
        defaultValue=""
        onConfirm={async (name) => {
          if (!createTarget || !workspaceRoot) return
          const relativePath = `${createTarget.rel.replace(/\\/g, '/')}/${name}`
          await ipcClient.invoke('workspace.fs.create', {
            workspaceRoot,
            relativePath,
            isDirectory: createTarget.isDirectory,
          })
          setCreateTarget(null)
          bumpTree()
        }}
        onCancel={() => setCreateTarget(null)}
      />
      {renameOpen && renameTarget
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[510] bg-black/20"
                aria-label="close"
                onClick={() => {
                  setRenameOpen(false)
                  setRenameTarget(null)
                }}
              />
              <div className="fixed left-1/2 top-1/2 z-[520] w-[min(320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-4 shadow-xl">
                <p className="mb-2 text-[13px] font-medium text-foreground">{t('rename.title')}</p>
                <input
                  className="mb-3 w-full rounded-lg border border-border/60 bg-[var(--bg-1)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--focus-border)]"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename()
                    if (e.key === 'Escape') {
                      setRenameOpen(false)
                      setRenameTarget(null)
                    }
                  }}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-[12px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
                    onClick={() => {
                      setRenameOpen(false)
                      setRenameTarget(null)
                    }}
                  >
                    {t('rename.cancel')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[var(--bg-active)] px-3 py-1.5 text-[12px] font-medium text-foreground hover:opacity-90"
                    onClick={() => void submitRename()}
                  >
                    {t('rename.confirm')}
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
