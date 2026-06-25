import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { RefreshCw, MessageSquareText, FolderGit2, Cpu, Plug, FileText } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { MarkdownResourceEditor } from '@renderer/features/settings/markdown-resource-editor'
import { resolvePromptRowDisplay } from '@renderer/features/settings/prompt-catalog-i18n'

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

const GROUP_ICON: Record<PromptCategory, typeof FileText> = {
  agents_context: FolderGit2,
  pi_builtin: Cpu,
  prompt_template: MessageSquareText,
  plugin_inject: Plug,
}

export function PromptsSettingsPanel() {
  const { t, i18n } = useTranslation()
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
      setVirtualSystemPreviewPath(res?.virtualSystemPreviewPath || null)
    } catch {
      toast.error(t('settings:prompts.loadFailed'))
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

  const editorReadOnly = selected?.readOnly === true || selected?.id === 'builtin:system:default'

  const displayGroups = useMemo(() => {
    const labels: Record<PromptCategory, string> = {
      plugin_inject: t('settings:prompts.pluginInject'),
      agents_context: t('settings:prompts.groupAgentsContext'),
      pi_builtin: t('settings:prompts.piBuiltin'),
      prompt_template: t('settings:prompts.promptTemplate'),
    }
    const order: PromptCategory[] = ['agents_context', 'pi_builtin', 'prompt_template', 'plugin_inject']
    return order
      .map((category) => ({
        category,
        label: labels[category],
        items: flat.filter((i) => i.category === category),
      }))
      .filter((g) => g.items.length > 0)
  }, [flat, i18n.language, t])

  return (
    <div className="w-full space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{t('settings:prompts.title')}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/75 leading-relaxed">
            {t('settings:prompts.description')}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md p-2 hover:bg-muted" title={t('common:refresh')}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="grid min-h-[min(72vh,640px)] gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-border/50">
          {loading && flat.length === 0 ? (
            <p className="p-4 text-[12px] text-muted-foreground">{t('settings:prompts.loading')}</p>
          ) : displayGroups.length === 0 ? (
            <p className="p-4 text-[12px] text-muted-foreground">{t('settings:prompts.empty')}</p>
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
                      {g.items.map((p) => {
                        const display = resolvePromptRowDisplay(p, t)
                        return (
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
                              <span className="text-[12px] font-medium leading-snug">{display.name}</span>
                              {p.inSystemContext ? (
                                <span className="shrink-0 rounded bg-brand/12 px-1 py-0.5 text-[9px] text-brand">
                                  {t('settings:prompts.perTurnSystem')}
                                </span>
                              ) : null}
                              {p.readOnly ? (
                                <span className="shrink-0 text-[9px] text-muted-foreground">{t('settings:prompts.readOnly')}</span>
                              ) : null}
                            </div>
                            {p.command ? (
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.command}</p>
                            ) : null}
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{display.description}</p>
                          </button>
                        </li>
                        )
                      })}
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
                ? t('settings:prompts.templateTitle', { command: selected.command })
                : resolvePromptRowDisplay(selected, t).name
              : ''
          }
          readOnly={editorReadOnly}
          onSaved={() => void load()}
        />
      </div>
    </div>
  )
}