import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { History, Eye, FileCode } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'

type Revision = { id: string; at: number; label: string; hash: string }

function RevisionMenu({ revisions, onRestore }: { revisions: Revision[]; onRestore: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] hover:bg-muted"
      >
        <History className="h-3.5 w-3.5" />
        版本 ({revisions.length})
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10" aria-label="关闭" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg">
            {revisions.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex w-full flex-col rounded px-2 py-1.5 text-left text-[10px] hover:bg-muted"
                onClick={() => {
                  setOpen(false)
                  onRestore(r.id)
                }}
              >
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground">
                  {new Date(r.at).toLocaleString('zh-CN')} · {r.hash}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function MarkdownResourceEditor({
  path,
  title,
  onSaved,
  readOnly = false,
}: {
  path: string | null
  title: string
  onSaved?: () => void
  readOnly?: boolean
}) {
  const [content, setContent] = useState('')
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [tab, setTab] = useState<'edit' | 'preview' | 'split'>('split')
  const [dirty, setDirty] = useState(false)
  const [savedContent, setSavedContent] = useState('')

  const markDirty = (v: boolean) => {
    setDirty(v)
    notifySettingsDirtyChanged()
  }

  useSettingsDirtySlice({
    id: 'prompts-editor',
    label: '提示词',
    isDirty: () => dirty && !readOnly && !!loadedPath,
    commit: async () => {
      if (!loadedPath || readOnly || !dirty) return
      const res = await ipcClient.invoke('resource.write', { path: loadedPath, content })
      if (!res?.ok) throw new Error(res?.error || '保存失败')
      setRevisions(res.revisions || [])
      setSavedContent(content)
      markDirty(false)
      onSaved?.()
    },
    discard: () => {
      if (!loadedPath) return
      setContent(savedContent)
      markDirty(false)
    },
  })

  const load = useCallback(async (p: string) => {
    const res = await ipcClient.invoke('resource.read', { path: p })
    if (res?.error) {
      toast.error(res.error)
      return
    }
    const text = res.content || ''
    setContent(text)
    setSavedContent(text)
    setLoadedPath(res.path || p)
    setRevisions(res.revisions || [])
    markDirty(false)
  }, [])

  useEffect(() => {
    if (readOnly) setTab('preview')
  }, [readOnly, path])

  useEffect(() => {
    if (path) void load(path)
    else {
      setContent('')
      setLoadedPath(null)
      setRevisions([])
      markDirty(false)
      setSavedContent('')
    }
  }, [path, load])

  const restore = async (revisionId: string) => {
    if (!loadedPath || readOnly) return
    const res = await ipcClient.invoke('resource.restore', { path: loadedPath, revisionId })
    if (!res?.ok) {
      toast.error(res?.error || '回退失败')
      return
    }
    setContent(res.content || '')
    setRevisions(res.revisions || [])
    setSavedContent(res.content || '')
    markDirty(false)
    toast.success('已回退到该版本')
    onSaved?.()
  }

  if (!path) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/15 text-[12px] text-muted-foreground">
        选择左侧一项以编辑
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{title}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{loadedPath}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex rounded-md border border-border/50 p-0.5 text-[10px]">
            {((readOnly ? ['preview'] : ['edit', 'split', 'preview']) as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-2 py-0.5',
                  tab === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t === 'edit' ? '编辑' : t === 'preview' ? '预览' : '分栏'}
              </button>
            ))}
          </div>
          {!readOnly && revisions.length > 0 && (
            <RevisionMenu revisions={revisions} onRestore={(id) => void restore(id)} />
          )}
          {!readOnly && dirty && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">未保存 · 用页面底部保存</span>
          )}
        </div>
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1',
          tab === 'split' ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        {!readOnly && (tab === 'edit' || tab === 'split') && (
          <div className="flex min-h-0 flex-col border-r border-border/40">
            <div className="flex items-center gap-1 border-b border-border/30 px-2 py-1 text-[10px] text-muted-foreground">
              <FileCode className="h-3 w-3" /> Markdown 源码
            </div>
            <textarea
              readOnly={readOnly}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none"
              value={content}
              spellCheck={false}
              onChange={(e) => {
                if (readOnly) return
                setContent(e.target.value)
                markDirty(true)
              }}
            />
          </div>
        )}
        {(tab === 'preview' || tab === 'split') && (
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center gap-1 border-b border-border/30 px-2 py-1 text-[10px] text-muted-foreground">
              <Eye className="h-3 w-3" /> 预览
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[14px] leading-relaxed">
              <MarkdownView>{content || '*（空）*'}</MarkdownView>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}