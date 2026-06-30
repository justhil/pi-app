import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { getAttachmentKind } from '@renderer/features/composer/attachments'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { useWorkspaceFs } from './use-workspace-fs'
import { FilePreviewRouter } from './file-preview-router'
import { FileTree } from './file-tree'
import { FilesContextMenuPortal, type FilesCtxTarget } from './files-context-menu-portal'

type RenameTarget = Pick<FilesCtxTarget, 'abs' | 'name' | 'rel'>

export function WorkspaceFilesPanel() {
  const { t } = useTranslation('files')
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  const { listDir, readText } = useWorkspaceFs(workspaceRoot)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [treeEpoch, setTreeEpoch] = useState(0)
  const [menu, setMenu] = useState<FilesCtxTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const displayPath = previewPath || selectedPath

  const onSelectPath = useCallback((rel: string, isDirectory: boolean) => {
    setSelectedPath(rel)
    if (!isDirectory) setPreviewPath(rel)
  }, [])

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
    const newRel = res.newRelativePath as string
    if (selectedPath === renameTarget.rel) setSelectedPath(newRel)
    if (previewPath === renameTarget.rel) setPreviewPath(newRel)
    bumpTree()
    toast.message(t('toast.renamed'))
  }

  if (!workspaceRoot) {
    return (
      <p className="px-4 py-8 text-center text-[12px] text-foreground-secondary/80">{t('empty.noWorkspace')}</p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-2.5">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground-secondary/90"
          title={displayPath || ''}
        >
          {displayPath || t('chrome.noFile')}
        </span>
        <button
          type="button"
          className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md"
          title={explorerCollapsed ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
          onClick={() => setExplorerCollapsed((v) => !v)}
        >
          {explorerCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <div
        className={cn('files-split-grid min-h-0 flex-1', explorerCollapsed && 'files-split-grid--collapsed')}
        style={{
          gridTemplateColumns: explorerCollapsed ? 'minmax(0, 1fr) 0px' : 'minmax(0, 1fr) 220px',
        }}
      >
        <OverlayScrollHost
          className="files-preview-scroll min-h-0 min-w-0 border-r border-border/40"
          scrollClassName="flex min-h-full flex-col p-3"
        >
          <FilePreviewRouter workspaceRoot={workspaceRoot} relativePath={previewPath} readText={readText} />
        </OverlayScrollHost>

        <div className="files-explorer-rail flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 px-2 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary/70" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                className="w-full rounded-lg border border-border/60 bg-[var(--bg-1)] py-1.5 pl-8 pr-2 text-[12px] outline-none transition-[border-color,box-shadow] duration-[var(--motion-normal)] focus:border-[var(--focus-border)] focus:shadow-[var(--focus-shadow)]"
              />
            </div>
          </div>
          <OverlayScrollHost className="min-h-0 flex-1" scrollClassName="px-1.5 pb-2">
            <FileTree
              key={treeEpoch}
              workspaceRoot={workspaceRoot}
              listDir={listDir}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              searchQuery={searchQuery}
              onContextMenuEntry={onContextMenuEntry}
            />
          </OverlayScrollHost>
        </div>
      </div>

      <FilesContextMenuPortal
        menu={menu}
        onClose={closeMenu}
        onPreview={() => {
          if (!menu || menu.isDirectory) return
          setPreviewPath(menu.rel)
          setSelectedPath(menu.rel)
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