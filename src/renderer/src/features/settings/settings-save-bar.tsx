import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'

export function SettingsSaveBar() {
  const { dirty, dirtySliceLabels, saving, discard, save } = useSettingsDraft()

  const onSave = async () => {
    const ok = await save()
    if (ok) toast.success('设置已保存')
    else toast.error('保存失败')
  }

  return (
    <div
      className={cn(
        'shrink-0 border-t border-border/60 bg-[var(--surface-sidebar)]/95 px-4 py-3 backdrop-blur-sm sm:px-6',
        'transition-shadow duration-motion-normal',
        dirty && 'shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.12)]',
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-[12px] text-muted-foreground">
          {dirty ? (
            <>
              <span className="text-amber-700 dark:text-amber-400">有未保存的更改</span>
              {dirtySliceLabels.length > 0 && (
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">
                  {dirtySliceLabels.join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span>所有更改已保存</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void discard().then(() => toast.message('已还原为上次保存'))}
            className="rounded-md border border-border/50 px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          >
            放弃更改
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
            className={cn(
              'rounded-md px-4 py-2 text-[12px] font-medium transition-all duration-motion-fast',
              dirty
                ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90'
                : 'bg-muted text-muted-foreground',
              (!dirty || saving) && 'pointer-events-none opacity-50',
              dirty && !saving && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-[var(--surface-sidebar)]',
            )}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}