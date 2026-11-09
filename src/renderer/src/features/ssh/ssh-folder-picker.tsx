import { useTranslation } from 'react-i18next'
import { Folder } from '@renderer/components/icons'
import { btnCompact } from '@renderer/features/settings/settings-controls'
import type { RemoteDirEntry, RemoteDirListing } from './ssh-types'

interface DirectoryActions {
  onNavigate: (path: string) => void
  onSelect: (path: string) => void
}

function DirectoryRow({ entry, onNavigate, onSelect }: DirectoryActions & { entry: RemoteDirEntry }) {
  const { t } = useTranslation('ssh')
  return (
    <div className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-accent/50">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-foreground"
        onClick={() => onNavigate(entry.path)}>
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
      </button>
      <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onSelect(entry.path)}>
        {t('chooseDirectory')}
      </button>
    </div>
  )
}

export function SshFolderPicker({ listing, loading, onNavigate, onSelect }: DirectoryActions & {
  listing: RemoteDirListing
  loading?: boolean
}) {
  const { t } = useTranslation('ssh')
  const { cwd, parent, dirs } = listing
  if (!listing.ok) {
    return <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{listing.error || t('directoryFailed')}</div>
  }
  return (
    <div className="mt-2 rounded-md border border-border/50 bg-[var(--bg-1)]/60 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border/40 pb-1.5">
        <span className="truncate font-mono text-xs text-foreground">{cwd}</span>
        <div className="flex shrink-0 items-center gap-1">
          {parent ? (
            <button type="button" className={btnCompact} disabled={loading} onClick={() => onNavigate(parent)}>
              {t('parentDirectory')}
            </button>
          ) : null}
          <button type="button" className={btnCompact} onClick={() => onSelect(cwd)}>{t('chooseCurrentDirectory')}</button>
        </div>
      </div>
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {dirs.length === 0 ? (
          <div className="py-2 text-center text-xs text-muted-foreground">{t('noSubdirectories')}</div>
        ) : dirs.map((entry) => <DirectoryRow key={entry.path} entry={entry} onNavigate={onNavigate} onSelect={onSelect} />)}
      </div>
    </div>
  )
}
