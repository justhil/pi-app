import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Maximize2, Minus, Search } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
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
import { RenamePromptDialog } from '@renderer/features/workspace/rename-prompt-dialog'

type RenameTarget = Pick<FilesCtxTarget, 'abs' | 'name' | 'rel'>

export function WorkspaceFilesPanel() {
  const { t } = useTranslation('files')
  const panelRef = useRef<HTMLDivElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  const activePanel = useUIStore((s) => s.activePanel)
  const filesPreviewChatExpand = useUIStore((s) => s.filesPreviewChatExpand)
  const rightPanelCollapsed = useRightPanelHidden()
  const revealRightPanel = useUIStore((s) => s.revealRightPanel)
  const [showDotfiles, setShowDotfiles] = useState(false)
  const { listDir, readText } = useWorkspaceFs(workspaceRoot, showDotfiles)
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
  const [collapseEpoch, setCollapseEpoch] = useState(0)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [menu, setMenu] = useState<FilesCtxTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [createTarget, setCreateTarget] = useState<{ rel: string; isDirectory: boolean } | null>(null)

  const selectedPath = activeTab?.rel ?? null
  const previewPath = activeTab?.rel ?? null
  const explorerHidden = explorerCollapsed && !!activeTab

  useEffect(() => {
    if (activePanel !== 'files' || !previewPath) {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [activePanel, previewPath])

  const exitExpandedPreview = useCallback(() => {
    useUIStore.setState({ filesPreviewChatExpand: false })
    expandButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!filesPreviewChatExpand || rightPanelCollapsed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return
      event.preventDefault()
      event.stopPropagation()
      exitExpandedPreview()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filesPreviewChatExpand, rightPanelCollapsed, exitExpandedPreview])

  useEffect(() => {
    return () => {
      useUIStore.setState({ filesPreviewChatExpand: false })
    }
  }, [])

  useEffect(() => {
    resetTabs()
  }, [workspaceRoot, resetTabs])

  useEffect(() => {
    // Refresh preview only when the files panel is the active right-panel tab and visible.
    // Collapsed right panel unmounts this host entirely (see app.tsx); no idle 2s reread.
    if (!activeTab || activePanel !== 'files') return
    if (rightPanelCollapsed) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      setPreviewRefreshKey((previous) => previous + 1)
    }
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeTab?.rel, activePanel, rightPanelCollapsed])

  const toggleChatPreviewExpand = useCallback(() => {
    if (!previewPath) return
    if (!filesPreviewChatExpand) {
      if (rightPanelCollapsed) revealRightPanel()
      useUIStore.setState({ filesPreviewChatExpand: true })
      return
    }
    useUIStore.setState({ filesPreviewChatExpand: false })
  }, [previewPath, filesPreviewChatExpand, rightPanelCollapsed, revealRightPanel])

  const onSelectPath = useCallback(
    (rel: string, isDirectory: boolean, opts?: { openInNewTab?: boolean }) => {
      if (isDirectory) return
      const name = rel.split('/').pop() || rel
      openFile(rel, name, opts?.openInNewTab ? 'new-tab' : 'replace')
      if (panelRef.current && panelRef.current.clientWidth <= 480 && !filesPreviewChatExpand) {
        setExplorerCollapsed(true)
      }
    },
    [openFile, filesPreviewChatExpand],
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
        ref={expandButtonRef}
        type="button"
        className={cn(
          'chrome-icon-btn flex h-7 shrink-0 items-center justify-center gap-1 rounded-md',
          filesPreviewChatExpand ? 'bg-[var(--bg-active)] px-2 text-[11px] text-foreground' : 'w-7',
        )}
        title={filesPreviewChatExpand ? t('chrome.collapsePreview') : t('chrome.expandPreview')}
        aria-label={filesPreviewChatExpand ? t('chrome.collapsePreview') : t('chrome.expandPreview')}
        aria-expanded={filesPreviewChatExpand}
        disabled={!previewPath && !filesPreviewChatExpand}
        onClick={toggleChatPreviewExpand}
      >
        {filesPreviewChatExpand ? <><ChevronRight className="h-3.5 w-3.5" /><span>{t('chrome.collapsePreview')}</span></> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="chrome-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        title={explorerHidden ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
        aria-label={explorerHidden ? t('chrome.expandExplorer') : t('chrome.collapseExplorer')}
        disabled={!previewPath}
        onClick={() => setExplorerCollapsed(!explorerHidden)}
      >
        {explorerHidden ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
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
    <div ref={panelRef} className="workspace-files-panel flex h-full min-h-0 flex-col">
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
        className={cn('files-split-grid min-h-0 flex-1', explorerHidden && 'files-split-grid--collapsed')}
        data-has-file={!!activeTab || undefined}
        style={{
          gridTemplateColumns: explorerHidden
            ? 'minmax(0, 1fr) 0px'
            : !activeTab
              ? '0px minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(150px, min(240px, 38%))',
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
              onExitExpandedPreview={exitExpandedPreview}
            />
          ) : (
            <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-[12px] text-foreground-secondary/80">
              {t('preview.pickFile')}
            </p>
          )}
        </div>

        <div className="files-explorer-rail flex min-h-0 min-w-0 flex-col overflow-hidden">
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
              title={t('tree.dotfiles')}
              aria-label={t('tree.dotfiles')}
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