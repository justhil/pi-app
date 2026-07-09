import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Maximize2, Search } from 'lucide-react'
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
import { FilePreviewTabBar } from './file-preview-tab-bar'
import { useFilePreviewTabs } from './use-file-preview-tabs'

type RenameTarget = Pick<FilesCtxTarget, 'abs' | 'name' | 'rel'>

export function WorkspaceFilesPanel() {
  const { t } = useTranslation('files')
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  const activePanel = useUIStore((s) => s.activePanel)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const rightPanelCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const { listDir, readText } = useWorkspaceFs(workspaceRoot)
  const {
    tabs,
    activeTab,
    openFile,
    closeTab,
    activateTab,
    reorderTabs,
    renameTabRel,
    resetTabs,
  } = useFilePreviewTabs()
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [treeEpoch, setTreeEpoch] = useState(0)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [menu, setMenu] = useState<FilesCtxTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const selectedPath = activeTab?.rel ?? null
  const previewPath = activeTab?.rel ?? null

  useEffect(() => {
    if (activePanel !== 'files') {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [activePanel])

  useEffect(() => {
    return () => {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [])

  useEffect(() => {
    resetTabs()
  }, [workspaceRoot, resetTabs])

  useEffect(() => {
    if (!activeTab || activePanel !== 'files') return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      setPreviewRefreshKey((k) => k + 1)
    }
    const id = window.setInterval(tick, 2000)
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeTab?.rel, activePanel])

  const toggleChatPreviewExpand = useCallback(() => {
    if (!previewPath) return
    if (!filesPreviewChatExpand) {
      if (rightPanelCollapsed) toggleRightPanel()
      useUIStore.setState({ filesPreviewChatExpand: true })
      return
    }
    useUIStore.setState({ filesPreviewChatExpand: false })
  }, [previewPath, filesPreviewChatExpand, rightPanelCollapsed, toggleRightPanel])

  const onSelectPath = useCallback(
    (rel: string, isDirectory: boolean, opts?: { openInNewTab?: boolean }) => {
      if (isDirectory) return
      const name = rel.split('/').pop() || rel
      openFile(rel, name, opts?.openInNewTab ? 'new-tab' : 'replace')
    },
    [openFile],
  )

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ rel?: string; name?: string }>).detail
      if (!d?.rel) return
      onSelectPath(d.rel, false)
    }
    window.addEventListener('pi-desktop:open-workspace-file', onOpen)
    return () => window.removeEventListener('pi-desktop:open-workspace-file', onOpen)
  }, [onSelectPath])

  const chromeTrailing = (
    <>
      <button
        type="button"
        className={cn(
          'chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          filesPreviewChatExpand && 'bg-[var(--bg-active)] text-foreground',
        )}
        title={filesPreviewChatExpand ? t('chrome.collapsePreview') : t('chrome.expandPreview')}
        disabled={!previewPath}
        onClick={toggleChatPreviewExpand}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        title={explorerCollapsed ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
        onClick={() => setExplorerCollapsed((v) => !v)}
      >
        {explorerCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
    </>
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
    const newRel = res.newRelativePath as string
    renameTabRel(renameTarget.rel, newRel, name)
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
      <FilePreviewTabBar
        workspaceRoot={workspaceRoot}
        tabs={tabs}
        activeId={activeTab?.id ?? null}
        onActivate={activateTab}
        onClose={closeTab}
        onReorder={reorderTabs}
        trailing={chromeTrailing}
      />

      <div
        className={cn('files-split-grid min-h-0 flex-1', explorerCollapsed && 'files-split-grid--collapsed')}
        style={{
          gridTemplateColumns: explorerCollapsed ? 'minmax(0, 1fr) 0px' : 'minmax(0, 1fr) 220px',
        }}
      >
        <div className="files-preview-scroll flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]">
          {activeTab ? (
            <FilePreviewRouter
              key={activeTab.id}
              workspaceRoot={workspaceRoot}
              relativePath={activeTab.rel}
              readText={readText}
              fill
              refreshKey={previewRefreshKey}
            />
          ) : (
            <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-[12px] text-foreground-secondary/80">
              {t('preview.pickFile')}
            </p>
          )}
        </div>

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
          onSelectPath(menu.rel, false)
        }}
        onOpenInNewTab={() => {
          if (!menu || menu.isDirectory) return
          onSelectPath(menu.rel, false, { openInNewTab: true })
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