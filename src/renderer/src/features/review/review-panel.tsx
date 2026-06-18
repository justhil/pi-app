import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { FilePlus, FileEdit, FileMinus, Copy, Check, GitBranch, Loader2, FileDiff } from 'lucide-react'

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-green-500" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-red-500" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

function parseGitStatus(status: string): { path: string; changeType: string }[] {
  if (!status) return []
  const lines = status.trim().split('\n').filter(Boolean)
  return lines.map((line) => {
    const code = line.substring(0, 2)
    const path = line.substring(3).trim()
    let changeType = 'modified'
    if (code.includes('A')) changeType = 'added'
    else if (code.includes('D')) changeType = 'deleted'
    else if (code.includes('R')) changeType = 'renamed'
    return { path, changeType }
  })
}

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [gitDiff, setGitDiff] = useState<{ files: { path: string; changeType: string }[]; raw: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (scope === 'git' && workspace) {
      setLoading(true)
      ipcClient.invoke('review.getDiff', { sessionId: '', scope: 'git' }).then((res) => {
        if (res?.diff) {
          setGitDiff({
            files: parseGitStatus(res.diff.status || ''),
            raw: res.diff.raw || '',
          })
        }
      }).catch(() => {}).finally(() => setLoading(false))
    }
  }, [scope, workspace])

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 1500)
  }

  const files = scope === 'git' ? (gitDiff?.files || []) : fileChanges

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border/80">
        {SCOPES.map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn(
              'relative flex-1 px-2 py-2.5 text-[11px] font-medium transition-all duration-motion-fast ease-motion-ease',
              scope === s
                ? 'text-foreground'
                : 'text-muted-foreground/60 hover:text-muted-foreground',
            )}
          >
            {t(`review.scope.${s}`)}
            {scope === s && (
              <div className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/30 text-muted-foreground/30">
              <FileDiff className="h-5 w-5" />
            </div>
            <span className="text-[11px] text-muted-foreground/40">{t('review.empty')}</span>
          </div>
        ) : (
          <div className="py-1.5">
            {files.map((fc, i) => (
              <div
                key={i}
                className="group flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/30 transition-all duration-motion-fast ease-motion-ease"
              >
                <ChangeIcon type={fc.changeType} />
                <span className="truncate font-mono text-[11px] leading-tight">{fc.path}</span>
                {scope === 'git' && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/40">git</span>
                )}
                <button
                  onClick={() => handleCopy(fc.path)}
                  className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:text-foreground transition-all"
                >
                  {copiedPath === fc.path ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
