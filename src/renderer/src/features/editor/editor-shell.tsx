import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useEditorStore, type EditorDoc } from '@renderer/stores/editor-store'
import { TAB_ITEM_ACTIVE_CLASS, TAB_ITEM_CLASS, TAB_ITEM_IDLE_CLASS, TAB_STRIP_CLASS } from '@renderer/components/ui/tab-strip'
import { FilePreviewRouter } from '@renderer/features/workspace-files/file-preview-router'
import { useWorkspaceFs } from '@renderer/features/workspace-files/use-workspace-fs'

function EditorTab({ doc, active }: { doc: EditorDoc; active: boolean }) {
  const { t } = useTranslation('files')
  const activate = useEditorStore((s) => s.activate)
  const close = useEditorStore((s) => s.close)
  return (
    <div
      className={cn(
        TAB_ITEM_CLASS,
        'group/tab min-w-0 max-w-[220px] gap-1',
        active ? TAB_ITEM_ACTIVE_CLASS : TAB_ITEM_IDLE_CLASS,
      )}
    >
      <button type="button" role="tab" aria-selected={active} className="min-w-0 flex-1 truncate text-left" title={doc.rel} onClick={() => activate(doc.id)}>
        {doc.name}
      </button>
      <button
        type="button"
        aria-label={t('editor.closeTab', { name: doc.name })}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/tab:opacity-100"
        onClick={() => close(doc.id)}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function EditorBody({ doc }: { doc: EditorDoc }) {
  const { readText } = useWorkspaceFs(doc.workspace)
  return (
    <FilePreviewRouter
      key={doc.id}
      workspaceRoot={doc.workspace}
      relativePath={doc.rel}
      readText={readText}
      fill
      sourceLocation={doc.line ? { line: doc.line } : null}
    />
  )
}

/**
 * Wraps a pane's chat with the file-tab strip. File tabs live in the main column, VS Code style;
 * the chat stays mounted (hidden) so the draft and the native undo stack survive.
 */
export function EditorShell({ sessionTitle, children }: { sessionTitle: string; children: ReactNode }) {
  const { t } = useTranslation('files')
  const docs = useEditorStore((s) => s.docs)
  const activeId = useEditorStore((s) => s.activeId)
  const activate = useEditorStore((s) => s.activate)
  const activeDoc = docs.find((d) => d.id === activeId) ?? null

  useEffect(() => {
    if (!activeDoc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      activate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeDoc, activate])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={t('editor.tabs')} className={cn(TAB_STRIP_CLASS, 'overflow-x-auto')}>
        <button
          type="button"
          role="tab"
          aria-selected={!activeDoc}
          className={cn(TAB_ITEM_CLASS, activeDoc ? TAB_ITEM_IDLE_CLASS : TAB_ITEM_ACTIVE_CLASS)}
          onClick={() => activate(null)}
        >
          <span className="max-w-[160px] truncate">{sessionTitle || t('editor.chatTab')}</span>
        </button>
        {docs.map((doc) => (
          <EditorTab key={doc.id} doc={doc} active={doc.id === activeId} />
        ))}
      </div>
      <div className={cn('min-h-0 flex-1', activeDoc && 'hidden')}>{children}</div>
      {activeDoc ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <EditorBody doc={activeDoc} />
        </div>
      ) : null}
    </div>
  )
}
