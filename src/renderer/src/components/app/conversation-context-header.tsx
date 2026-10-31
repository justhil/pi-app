import { useTranslation } from 'react-i18next'
import { Folder, GitBranch } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { diskProjectName, isSandboxPath } from '@renderer/features/workspace/project-sidebar-types'

export function ConversationContextHeader({
  workspacePath,
  branch,
}: {
  workspacePath: string | null
  branch?: string
}) {
  const { t } = useTranslation()
  const compact = useUIStore((state) => state.sidebarStyle === 'compact')
  if (!compact || !workspacePath || isSandboxPath(workspacePath)) return null

  return (
    <div
      role="group"
      aria-label={t('common:conversationContext.title')}
      className="flex min-h-10 shrink-0 items-center gap-4 border-b border-border/40 py-2 pl-4 pr-14 text-xs text-foreground-secondary"
      data-conversation-context=""
    >
      <div className="flex min-w-0 items-center gap-1.5" title={workspacePath}>
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate"><span className="sr-only">{t('common:conversationContext.workspace')}: </span>{diskProjectName(workspacePath)}</span>
      </div>
      {branch && (
        <div className="flex min-w-0 items-center gap-1.5" title={branch}>
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate"><span className="sr-only">{t('common:conversationContext.branch')}: </span>{branch.replace(/^refs\/heads\//, '')}</span>
        </div>
      )}
    </div>
  )
}
