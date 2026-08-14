import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { RefreshCw, ChevronDown, ChevronRight } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'
import { useSessionContextPreview } from './use-session-context-preview'
import { ContextMessageBody } from './context-message-body'

const ROLE_STYLE: Record<string, { badge: string; labelKey: string }> = {
  user: { badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', labelKey: 'context:userLabel' },
  assistant: { badge: 'bg-brand/15 text-foreground', labelKey: 'context:assistantLabel' },
  toolResult: { badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-200', labelKey: 'context:toolResultLabel' },
  compactionSummary: { badge: 'bg-purple-500/15 text-purple-800 dark:text-purple-200', labelKey: 'context:compactionLabel' },
  branchSummary: { badge: 'bg-purple-500/10 text-purple-700', labelKey: 'context:branchLabel' },
  system: { badge: 'bg-[var(--aou-6)]/15 text-[var(--aou-8)] dark:text-[var(--aou-4)]', labelKey: 'context:systemLabel' },
}

function roleMeta(role: string) {
  return ROLE_STYLE[role] || { badge: 'bg-muted text-foreground-secondary', labelKey: '' }
}

export function ContextPanel() {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const { preview, loading, refresh } = useSessionContextPreview()
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    setExpanded(new Set())
  }, [preview?.sessionFile])

  const estTokens = preview ? estTokensFromChars(preview.estimatedChars) : null
  const segments = preview?.segments || []

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  if (!workspace) {
    return (
      <div className="p-4 text-[13px] leading-relaxed text-foreground-secondary">
        {t('context:openProjectHint')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5">
        <p className="min-w-0 truncate text-[12px] tabular-nums text-foreground-secondary">
          {preview
            ? t('context:listSummary', {
                count: preview.messageCount,
                tokens: formatTokens(estTokens ?? 0),
              })
            : t('context:empty')}
        </p>
        <button type="button" onClick={() => void refresh()} className="chrome-icon-btn rounded-md p-1.5" title={t('context:refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {!preview ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <p className="text-[13px] leading-relaxed text-foreground-secondary/80">
            {t('context:workerNotReady')}
          </p>
        </div>
      ) : segments.length === 0 ? (
        <p className="px-3 py-6 text-[12px] text-foreground-secondary/70">暂无消息片段</p>
      ) : (
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto py-1">
          {segments.map((seg) => {
            const meta = roleMeta(seg.role)
            const open = expanded.has(seg.index)
            return (
              <div key={seg.index}>
                <button
                  type="button"
                  onClick={() => toggle(seg.index)}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                >
                  {open ? (
                    <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
                        {meta.labelKey ? t(meta.labelKey) : seg.role}
                        {seg.label ? ` · ${seg.label}` : ''}
                      </span>
                      <span className="text-[10px] tabular-nums text-foreground-secondary/70">
                        ~{formatTokens(estTokensFromChars(seg.chars))} tok
                      </span>
                    </div>
                    {!open && seg.preview ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-foreground-secondary/85">
                        {seg.preview}
                      </p>
                    ) : null}
                  </div>
                </button>
                {open ? (
                  <ContextMessageBody>
                    {seg.preview || '(空)'}
                    {seg.chars > 280 && (
                      <span className="text-foreground-secondary/50"> … {seg.chars}</span>
                    )}
                  </ContextMessageBody>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
