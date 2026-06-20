import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, MessageSquareText, FolderGit2, Cpu, Plug, FileText } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { MarkdownResourceEditor } from '@renderer/features/settings/markdown-resource-editor'

type PromptCategory = 'plugin_inject' | 'agents_context' | 'pi_builtin' | 'prompt_template'

type PromptRow = {
  id: string
  category: PromptCategory
  name: string
  description: string
  path: string | null
  command: string
  source?: string
  editable?: boolean
  readOnly?: boolean
  inSystemContext?: boolean
}

type PromptGroup = { category: PromptCategory; label: string; items: PromptRow[] }

const GROUP_ICON: Record<PromptCategory, typeof FileText> = {
  agents_context: FolderGit2,
  pi_builtin: Cpu,
  prompt_template: MessageSquareText,
  plugin_inject: Plug,
}

export function PromptsSettingsPanel() {
  const [groups, setGroups] = useState<PromptGroup[]>([])
  const [flat, setFlat] = useState<PromptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [virtualSystemPreviewPath, setVirtualSystemPreviewPath] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await ipcClient.invoke('prompts.list')
      const prompts: PromptRow[] = res?.prompts || []
      setFlat(prompts)
      setGroups(res?.groups?.length ? res.groups : [])
      setVirtualSystemPreviewPath(res?.virtualSystemPreviewPath || null)
    } catch {
      toast.error('加载提示词失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(() => flat.find((p) => p.id === selectedId), [flat, selectedId])

  const editorPath = useMemo(() => {
    if (!selected) return null
    if (selected.id === 'builtin:system:default' && virtualSystemPreviewPath) {
      return virtualSystemPreviewPath
    }
    return selected.path
  }, [selected, virtualSystemPreviewPath])

  const displayGroups = useMemo(() => {
    if (groups.length > 0) return groups
    const labels: Record<PromptCategory, string> = {
      plugin_inject: '插件注入',
      agents_context: '项目上下文（AGENTS.md 等）',
      pi_builtin: 'pi 内置 / SYSTEM',
      prompt_template: '提示词模板（/name）',
    }
    const order: PromptCategory[] = ['agents_context', 'pi_builtin', 'prompt_template', 'plugin_inject']
    return order
      .map((category) => ({
        category,
        label: labels[category],
        items: flat.filter((i) => i.category === category),
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, flat])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">提示词与上下文</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/75 leading-relaxed">
            按进入对话上下文的方式分组：<strong>项目上下文</strong>（AGENTS.md / CLAUDE.md）、
            <strong>pi 内置 SYSTEM</strong>、<strong>/name 模板</strong>、<strong>扩展包内 Markdown</strong>。
            带「每轮 system」标记的会随会话注入；模板仅在输入 <code className="rounded bg-muted px-1 text-[10px]">/name</code>{' '}
            时展开。
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md p-2 hover:bg-muted" title="刷新">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-border/50">
          {loading && flat.length === 0 ? (
            <p className="p-4 text-[12px] text-muted-foreground">加载中…</p>
          ) : displayGroups.length === 0 ? (
            <p className="p-4 text-[12px] text-muted-foreground">未发现条目（打开工作区后刷新）</p>
          ) : (
            <div className="divide-y divide-border/40">
              {displayGroups.map((g) => {
                const Icon = GROUP_ICON[g.category]
                return (
                  <section key={g.category}>
                    <div className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-border/30 bg-[var(--bg-1)]/95 px-3 py-2 backdrop-blur-sm">
                      <Icon className="h-3.5 w-3.5 text-primary/75" />
                      <span className="text-[11px] font-semibold text-foreground/90">{g.label}</span>
                      <span className="text-[10px] text-muted-foreground/60">({g.items.length})</span>
                    </div>
                    <ul>
                      {g.items.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={!p.path && p.id !== 'builtin:system:default'}
                            onClick={() => setSelectedId(p.id)}
                            className={cn(
                              'w-full px-3 py-2.5 text-left disabled:opacity-45',
                              selectedId === p.id && 'bg-primary/8',
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium leading-snug">{p.name}</span>
                              {p.inSystemContext ? (
                                <span className="shrink-0 rounded bg-brand/12 px-1 py-0.5 text-[9px] text-brand">
                                  每轮 system
                                </span>
                              ) : null}
                              {p.readOnly ? (
                                <span className="shrink-0 text-[9px] text-muted-foreground">只读</span>
                              ) : null}
                            </div>
                            {p.command ? (
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.command}</p>
                            ) : null}
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{p.description}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <MarkdownResourceEditor
          path={editorPath}
          title={
            selected
              ? selected.command
                ? `模板 ${selected.command}`
                : selected.name
              : ''
          }
          readOnly={selected?.readOnly || selected?.id === 'builtin:system:default'}
          onSaved={() => void load()}
        />
      </div>
    </div>
  )
}