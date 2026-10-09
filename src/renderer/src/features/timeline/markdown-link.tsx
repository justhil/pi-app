import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { LinkPreview } from '@shared/link-preview'
import { Copy, ExternalLink, File, FolderOpen, Globe } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { localFileLineFromHref, localFilePathFromHref, openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'

function previewText(value?: string): string | undefined {
  if (!value) return undefined
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value.replace(/</g, '&lt;')
  return textarea.value
}

export function MarkdownLink({ href, children, baseDirectory, ...props }: ComponentPropsWithoutRef<'a'> & { baseDirectory?: string }) {
  const { t } = useTranslation()
  const workspaceRoot = useUIStore((store) => store.currentWorkspace)
  const filePath = href ? localFilePathFromHref(href, baseDirectory ?? workspaceRoot) : null
  const previewId = useId()
  const anchor = useRef<HTMLAnchorElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const dismissed = useRef(false)
  const [open, setOpen] = useState<'preview' | 'menu' | null>(null)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const zoom = Number(document.documentElement.style.zoom) || 1
  let webUrl: URL | null = null
  try {
    const url = new URL(href ?? '')
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) webUrl = url
  } catch { /* Local paths are handled below. */ }
  const isWeb = !!webUrl

  const clearTimer = () => clearTimeout(timer.current)
  const close = () => {
    clearTimer()
    dismissed.current = true
    setOpen(null)
  }
  useDismissContextMenu(!!open, panel, close)

  useEffect(() => {
    setOpen(null)
    setPreview(null)
    return () => clearTimeout(timer.current)
  }, [href, baseDirectory, workspaceRoot])

  useEffect(() => {
    if (open !== 'preview' || !href || !isWeb) return
    let active = true
    void ipcClient.invoke('link.preview', { url: href }).then((result: LinkPreview) => {
      if (active) setPreview(result?.url ? result : { url: href })
    }).catch(() => { if (active) setPreview({ url: href }) })
    return () => { active = false }
  }, [href, open, isWeb])

  useLayoutEffect(() => {
    if (!open || !panel.current || !anchor.current) return
    // Fixed positions use CSS pixels; the app's UI zoom makes DOM rects visual pixels.
    const zoom = Number(document.documentElement.style.zoom) || 1
    const rect = anchor.current.getBoundingClientRect()
    const bounds = panel.current.getBoundingClientRect()
    const x = open === 'menu' ? point.x : rect.left
    const y = open === 'menu' ? point.y : rect.bottom + 6 * zoom
    const top = y + bounds.height <= window.innerHeight - 8
      ? y : (open === 'preview' ? rect.top - bounds.height - 6 * zoom : window.innerHeight - bounds.height - 8)
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)) / zoom,
      top: Math.max(8, top) / zoom,
    })
    if (open === 'menu') panel.current.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open, point, preview])

  const showPreview = (immediate = false) => {
    clearTimer()
    if ((!webUrl && !filePath) || open === 'menu' || dismissed.current) return
    if (immediate) setOpen('preview')
    else timer.current = setTimeout(() => setOpen('preview'), 800)
  }
  const hidePreview = () => {
    clearTimer()
    if (open === 'menu') return
    timer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement) && document.activeElement !== anchor.current) setOpen(null)
    }, 180)
  }
  const openExternal = async () => {
    close()
    anchor.current?.focus()
    try {
      const result = await ipcClient.invoke('shell.openExternal', { url: href })
      if (!result?.ok) toast.error(t('timeline:link.openFailed'))
    } catch { toast.error(t('timeline:link.openFailed')) }
  }
  const openFile = async () => {
    close()
    anchor.current?.focus()
    if (!filePath || openWorkspaceRelativePath(filePath, localFileLineFromHref(href!))) return
    if (!/^[/\\]|^[a-zA-Z]:[/\\]/.test(filePath)) {
      toast.error(t('common:sidebar.revealFailed'))
      return
    }
    try {
      const result = await ipcClient.invoke('shell.openPath', { path: filePath })
      if (!result?.ok) toast.error(t('common:sidebar.revealFailed'))
    } catch { toast.error(t('common:sidebar.revealFailed')) }
  }
  const revealFile = async () => {
    close()
    anchor.current?.focus()
    if (!filePath || !/^[/\\]|^[a-zA-Z]:[/\\]/.test(filePath)) {
      toast.error(t('common:sidebar.revealFailed'))
      return
    }
    try {
      const result = await ipcClient.invoke('shell.showItemInFolder', { path: filePath })
      if (!result?.ok) toast.error(t('common:sidebar.revealFailed'))
    } catch { toast.error(t('common:sidebar.revealFailed')) }
  }
  const copyLink = async () => {
    close()
    anchor.current?.focus()
    try {
      await navigator.clipboard.writeText(filePath || href!)
      toast.success(t('timeline:copied'))
    } catch { toast.error(t(filePath ? 'timeline:link.copyPathFailed' : 'timeline:link.copyFailed')) }
  }

  return (
    <>
      <a
        {...props}
        ref={anchor}
        href={href}
        target={filePath ? undefined : props.target}
        onClick={filePath ? (event) => { event.preventDefault(); void openFile() } : props.onClick}
        onAuxClick={filePath ? (event) => { if (event.button === 1) { event.preventDefault(); void openFile() } } : props.onAuxClick}
        aria-describedby={open === 'preview' ? previewId : undefined}
        className={cn(props.className, 'rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring')}
        title={webUrl ? undefined : filePath || props.title}
        onMouseEnter={() => { dismissed.current = false; showPreview() }}
        onMouseLeave={hidePreview}
        onFocus={() => showPreview(true)}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget as Node)) dismissed.current = false
          hidePreview()
        }}
        onContextMenu={(event) => {
          if (!href) return
          event.preventDefault()
          event.stopPropagation()
          clearTimer()
          setPoint({ x: event.clientX, y: event.clientY })
          setOpen('menu')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
          if (href && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault()
            clearTimer()
            const rect = event.currentTarget.getBoundingClientRect()
            setPoint({ x: rect.left, y: rect.bottom })
            setOpen('menu')
          }
        }}
      >
        {children}
      </a>
      {open && createPortal(
        <div
          ref={panel}
          id={open === 'preview' ? previewId : undefined}
          role={open === 'menu' ? 'menu' : 'dialog'}
          aria-label={t(open === 'menu' ? 'timeline:link.menu' : 'timeline:link.preview')}
          className={open === 'menu' ? contextMenuPanelClass : 'electron-no-drag fixed z-[490] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl'}
          style={{ ...position, width: open === 'preview' ? 360 : undefined, maxWidth: (window.innerWidth - 16) / zoom, maxHeight: (window.innerHeight - 16) / zoom, overflowY: 'auto' }}
          onMouseEnter={clearTimer}
          onMouseLeave={hidePreview}
          onFocus={clearTimer}
          onBlur={hidePreview}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
              anchor.current?.focus()
              return
            }
            if (open !== 'menu') return
            if (event.key === 'Tab') { close(); anchor.current?.focus(); return }
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              buttons[next]?.focus()
            }
          }}
        >
          {open === 'menu' ? (
            <>
              {webUrl && <button type="button" role="menuitem" className={cn(contextMenuItemClass, 'focus-visible:ring-2 focus-visible:ring-ring')} onClick={() => void openExternal()}>
                <ExternalLink className="h-4 w-4" />{t('timeline:link.openExternal')}
              </button>}
              {filePath && <>
                <button type="button" role="menuitem" className={cn(contextMenuItemClass, 'focus-visible:ring-2 focus-visible:ring-ring')} onClick={() => void openFile()}>
                  <File className="h-4 w-4" />{t('timeline:link.openFile')}
                </button>
                <button type="button" role="menuitem" className={cn(contextMenuItemClass, 'focus-visible:ring-2 focus-visible:ring-ring')} onClick={() => void revealFile()}>
                  <FolderOpen className="h-4 w-4" />{t('files:menu.reveal')}
                </button>
              </>}
              <button type="button" role="menuitem" className={cn(contextMenuItemClass, 'focus-visible:ring-2 focus-visible:ring-ring')} onClick={() => void copyLink()}>
                <Copy className="h-4 w-4" />{t(filePath ? 'files:menu.copyPath' : 'timeline:link.copy')}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  {filePath ? <File className="h-3.5 w-3.5 shrink-0" /> : <Globe className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{filePath ? filePath.split(/[/\\]/).pop() : webUrl?.hostname}</span>
                </span>
                <button type="button" className="flex shrink-0 items-center gap-1 rounded px-2 py-1 hover:bg-accent active:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void (filePath ? openFile() : openExternal())}>
                  {t(filePath ? 'timeline:link.openFile' : 'timeline:link.open')}<ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              {preview?.image && <img src={preview.image} alt="" className="h-44 w-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} />}
              <div className="space-y-2 px-4 py-3">
                <div className="line-clamp-2 break-words text-sm font-semibold">{previewText(preview?.title) || children}</div>
                {isWeb && !preview && <p role="status" className="text-xs text-muted-foreground">{t('common:loading')}</p>}
                {preview?.description && <p className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">{previewText(preview.description)}</p>}
                <p className={cn('text-xs text-muted-foreground', filePath ? 'break-all' : 'truncate')} title={filePath || href}>{filePath || href}</p>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
