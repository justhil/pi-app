import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { FileText, FileEdit, FilePlus, FileMinus, Copy, ExternalLink } from 'lucide-react'
import type { FileChange } from '@shared/app-events'

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-green-500" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-red-500" />
  if (type === 'renamed') return <FileEdit className="h-3.5 w-3.5 text-blue-500" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border">
        {SCOPES.map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn(
              'flex-1 px-2 py-2 text-xs font-medium transition-all duration-motion-fast ease-motion-ease',
              scope === s
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`review.scope.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {fileChanges.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
            {t('review.empty')}
          </div>
        ) : (
          <div className="py-1">
            {fileChanges.map((fc, i) => (
              <div
                key={i}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors duration-motion-fast ease-motion-ease"
              >
                <ChangeIcon type={fc.changeType} />
                <span className="truncate font-mono">{fc.path}</span>
                <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-motion-fast">
                  <button
                    onClick={() => navigator.clipboard.writeText(fc.path)}
                    className="rounded p-0.5 hover:bg-accent"
                    title={t('review.copyPath')}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
