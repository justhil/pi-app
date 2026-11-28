import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Folder, FolderOpen, MessageSquare } from '@renderer/components/icons'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { EPHEMERAL_DRAFT_SESSION_ID, PENDING_NEW_SESSION_ID } from '@renderer/lib/session-ids'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { diskProjectName, isSandboxPath } from '@renderer/features/workspace/project-sidebar-types'
import { resolveProjectDisplayName, workspacePathsEqual } from '@shared/workspace-path'
import { serializeRichInput } from './attachments'
import {
  composerDraftContextKey,
  readTransientComposerImages,
  rememberTransientComposerDraft,
  rememberTransientComposerImages,
} from './composer-transient-draft'

function carryOverBlankDraft(targetWorkspace: string | null): void {
  const store = useUIStore.getState()
  if (store.historySessionFile || store.timelineItems.length > 0) return
  const el = document.querySelector('[data-pi-slot="composer-input"]') as HTMLElement | null
  if (!el) return
  const { segments } = serializeRichInput(el)
  const images = readTransientComposerImages(composerDraftContextKey(store)) ?? []
  if (segments.length === 0 && images.length === 0) return
  const targetKey = targetWorkspace
    ? composerDraftContextKey({
        currentWorkspace: targetWorkspace,
        currentSessionId: PENDING_NEW_SESSION_ID,
        historySessionFile: null,
        ephemeralSandboxDraft: false,
        pendingNewSessionPlaceholder: true,
      })
    : composerDraftContextKey({
        currentWorkspace: null,
        currentSessionId: EPHEMERAL_DRAFT_SESSION_ID,
        historySessionFile: null,
        ephemeralSandboxDraft: true,
        pendingNewSessionPlaceholder: false,
      })
  if (segments.length > 0) rememberTransientComposerDraft(targetKey, segments)
  if (images.length > 0) rememberTransientComposerImages(targetKey, images)
}

function ProjectOptionRow({
  path,
  name,
  selected,
  onSelect,
}: {
  path: string
  name: string
  selected: boolean
  onSelect: (path: string) => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(path)}
      title={path}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
        selected
          ? 'bg-foreground/[0.07] font-medium text-foreground'
          : 'text-foreground/85 hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
    >
      <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
    </button>
  )
}

function ProjectPickerMenu({
  isNoProject,
  currentWorkspace,
  diskProjects,
  projectDisplayNames,
  popAlignRight,
  onSelectNoProject,
  onSelectProject,
  onBrowseFolder,
}: {
  isNoProject: boolean
  currentWorkspace: string | null
  diskProjects: string[]
  projectDisplayNames: Record<string, string>
  popAlignRight: boolean
  onSelectNoProject: () => void
  onSelectProject: (path: string) => void
  onBrowseFolder: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="listbox"
      aria-label={t('composer:projectPicker.ariaLabel')}
      className={cn(
        'overlay-panel absolute bottom-full z-50 mb-1.5 w-[268px] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl',
        popAlignRight ? 'right-0' : 'left-0',
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={isNoProject}
        onClick={onSelectNoProject}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
          isNoProject ? 'bg-foreground/[0.07] text-foreground' : 'hover:bg-[var(--bg-hover)]',
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-foreground">
            <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-75" />
            <span>{t('composer:projectPicker.noProject')}</span>
          </div>
          <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
            {t('composer:projectPicker.noProjectDesc')}
          </div>
        </div>
        {isNoProject ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
      </button>

      {diskProjects.length > 0 ? (
        <>
          <div className="my-1 h-px bg-border/50" />
          <div className="px-2.5 py-1 text-[10.5px] font-medium tracking-wide text-muted-foreground">
            {t('composer:projectPicker.projectsHeading')}
          </div>
          <div className="studio-thin-scroll max-h-[210px] space-y-0.5 overflow-y-auto">
            {diskProjects.map((p) => (
              <ProjectOptionRow
                key={p}
                path={p}
                name={resolveProjectDisplayName(projectDisplayNames, p, diskProjectName(p))}
                selected={!isNoProject && workspacePathsEqual(p, currentWorkspace)}
                onSelect={onSelectProject}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="my-1 h-px bg-border/50" />
      <button
        type="button"
        onClick={onBrowseFolder}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span>{t('composer:projectPicker.openFolder')}</span>
      </button>
    </div>
  )
}

export function ComposerProjectPicker({
  isStatusBar = false,
  isPill = false,
  popAlignRight = false,
}: {
  isStatusBar?: boolean
  isPill?: boolean
  popAlignRight?: boolean
}) {
  const { t } = useTranslation()
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const timelineCount = useUIStore((s) => s.timelineItems.length)
  const recentProjects = useUIStore((s) => s.recentProjects)
  const projectDisplayNames = useUIStore((s) => s.projectDisplayNames)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const isBlankChat = !historySessionFile && timelineCount === 0
  const isNoProject = ephemeralSandboxDraft || !currentWorkspace || isSandboxPath(currentWorkspace)
  const diskProjects = useMemo(() => recentProjects.filter((p) => !isSandboxPath(p)), [recentProjects])
  const currentLabel = isNoProject
    ? t('composer:projectPicker.noProject')
    : resolveProjectDisplayName(projectDisplayNames, currentWorkspace, diskProjectName(currentWorkspace))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectNoProject = () => {
    setOpen(false)
    if (isNoProject && isBlankChat) return
    const run = () => {
      carryOverBlankDraft(null)
      enterBlankSession('ephemeral-sandbox')
      void refreshComposerRunDisplay()
    }
    if (isBlankChat) run()
    else guardSessionSwitch(run)
  }

  const selectProject = (path: string) => {
    setOpen(false)
    if (!isNoProject && workspacePathsEqual(path, currentWorkspace) && isBlankChat) return
    const run = () => {
      carryOverBlankDraft(path)
      void activateWorkspace(path, { preferHome: true })
    }
    if (isBlankChat) run()
    else guardSessionSwitch(() => void activateWorkspace(path))
  }

  const browseFolder = async () => {
    setOpen(false)
    const res = await window.piDesktop?.invoke('ipc:dialog:openDirectory').catch(() => null)
    if (!res?.path) return
    carryOverBlankDraft(res.path)
    await activateWorkspace(res.path, { preferHome: true })
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center">
      <button
        type="button"
        data-pi-slot="composer-project-picker"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={isNoProject ? currentLabel : `${currentLabel} (${currentWorkspace})`}
        aria-label={t('composer:projectPicker.ariaLabel')}
        onClick={() => setOpen((v) => !v)}
        className={
          isStatusBar
            ? 'workbench-status-trigger'
            : cn(
                'inline-flex h-6 max-w-[200px] items-center gap-1.5 text-[11.5px] transition-colors',
                isPill
                  ? 'rounded-full border border-border/75 bg-background/85 px-2.5 hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground'
                  : 'rounded-md border border-transparent px-1.5 hover:bg-[var(--bg-hover)] hover:text-foreground',
                isNoProject ? 'text-foreground-secondary' : 'font-medium text-foreground',
              )
        }
      >
        {isNoProject ? (
          <MessageSquare className={cn(isStatusBar ? 'h-3 w-3' : 'h-3.5 w-3.5', 'shrink-0 opacity-70')} />
        ) : (
          <Folder className={cn(isStatusBar ? 'h-3 w-3' : 'h-3.5 w-3.5', 'shrink-0 opacity-80')} />
        )}
        <span className="truncate">{currentLabel}</span>
        {!isStatusBar ? <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-55 transition-transform', open && 'rotate-180')} /> : null}
      </button>
      {open ? (
        <ProjectPickerMenu
          isNoProject={isNoProject}
          currentWorkspace={currentWorkspace}
          diskProjects={diskProjects}
          projectDisplayNames={projectDisplayNames}
          popAlignRight={popAlignRight}
          onSelectNoProject={selectNoProject}
          onSelectProject={selectProject}
          onBrowseFolder={() => void browseFolder()}
        />
      ) : null}
    </div>
  )
}
