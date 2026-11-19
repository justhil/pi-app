import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Brain,
  CheckCircle2,
  Cpu,
  GitBranch,
  Layers,
  Sparkles,
  Target,
  Terminal,
  type AppIconComponent,
} from '@renderer/components/icons'
import type { StatusBarPillSnapshot } from '@shared/background-tasks'
import { resolveAdapterText } from '@extension-compat/adapter-schema'
import { currentAdapterCatalog } from '@renderer/lib/adapter-catalog'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  selectSessionStatusPills,
  useAdapterStatusBarStore,
} from '@renderer/stores/adapter-status-bar-store'
import {
  collectVisibleBackgroundTasks,
  useBackgroundTasksStore,
} from '@renderer/stores/background-tasks-store'
import { ipcClient } from '@renderer/lib/ipc-client'

const STATUS_BAR_ICONS: Record<string, AppIconComponent> = {
  Activity,
  Terminal,
  Target,
  Brain,
  GitBranch,
  ListTodo: CheckCircle2,
  CheckCircle2,
  Layers,
  Cpu,
  Sparkles,
}

function resolveStatusIcon(name: string | undefined, fallback: AppIconComponent): AppIconComponent {
  if (!name) return fallback
  return STATUS_BAR_ICONS[name] ?? fallback
}

export function StatusBarAdapterSlots({
  activeSessionFile,
  bgTasksOpen,
  bgTasksAnchor,
  onToggleBgTasks,
}: {
  activeSessionFile: string | null | undefined
  bgTasksOpen: boolean
  bgTasksAnchor: RefObject<HTMLButtonElement>
  onToggleBgTasks: () => void
}) {
  const { t, i18n } = useTranslation()
  const tasksBySession = useBackgroundTasksStore((s) => s.tasksBySession)
  const activeAdapterBySession = useBackgroundTasksStore((s) => s.activeAdapterBySession)
  const pillsBySession = useAdapterStatusBarStore((s) => s.pillsBySession)
  const bgSummary = collectVisibleBackgroundTasks(
    tasksBySession,
    activeAdapterBySession,
    activeSessionFile,
  )
  const pills = selectSessionStatusPills(pillsBySession, activeSessionFile)

  const resolveLocalizedStatusTitle = (adapterId: string | undefined, fallback?: string): string | undefined => {
    if (!adapterId) return fallback
    const adapter = currentAdapterCatalog().find((item) => item.id === adapterId)
    if (!adapter) return fallback
    const resolved = resolveAdapterText(adapter, i18n.language)
    return resolved.statusBar.title || resolved.displayName || fallback
  }

  const handlePillClick = (pill: StatusBarPillSnapshot) => {
    const action = pill.clickAction
    if (!action || action.type === 'none') return
    if (action.type === 'slash' && action.command) {
      const sf = useUIStore.getState().historySessionFile
      if (sf) {
        void ipcClient.invoke('prompt.send', { sessionFile: sf, text: action.command }).catch(() => {})
      }
      return
    }
    if (action.type === 'open-panel') {
      const panel = action.panelId || `adapter:${pill.adapterId}`
      useUIStore.getState().setActivePanel(panel)
      return
    }
    if (action.type === 'config-page') {
      useUIStore.getState().requestExtensionConfig(pill.adapterId)
    }
  }

  const BgIcon = resolveStatusIcon(bgSummary.activeAdapter?.icon, Activity)
  const bgTitle =
    resolveLocalizedStatusTitle(bgSummary.activeAdapter?.adapterId, bgSummary.activeAdapter?.title) ||
    t('common:bgTasks.title')

  return (
    <>
      {pills.map((pill) => {
        const PillIcon = resolveStatusIcon(pill.icon, Activity)
        const clickable = Boolean(pill.clickAction && pill.clickAction.type !== 'none')
        const localizedTitle = resolveLocalizedStatusTitle(pill.adapterId, pill.title)
        const tooltip = localizedTitle ? `${localizedTitle}: ${pill.text}` : pill.text
        if (!clickable) {
          return (
            <span
              key={`${pill.adapterId}:${pill.statusKey}`}
              data-testid={`statusbar-pill-${pill.statusKey}`}
              title={tooltip}
              className="workbench-status-trigger cursor-default"
            >
              <PillIcon className="h-3 w-3 opacity-80" />
              <span className="max-w-[10rem] truncate tabular-nums">{pill.text}</span>
            </span>
          )
        }
        return (
          <button
            key={`${pill.adapterId}:${pill.statusKey}`}
            type="button"
            data-testid={`statusbar-pill-${pill.statusKey}`}
            title={tooltip}
            aria-label={tooltip}
            className="workbench-status-trigger"
            onClick={() => handlePillClick(pill)}
          >
            <PillIcon className="h-3 w-3 opacity-80" />
            <span className="max-w-[10rem] truncate tabular-nums">{pill.text}</span>
          </button>
        )
      })}

      {bgSummary.shouldShowTrigger ? (
        <button
          ref={bgTasksAnchor}
          type="button"
          className="workbench-status-trigger"
          data-testid="statusbar-bg-tasks-trigger"
          aria-haspopup="dialog"
          aria-expanded={bgTasksOpen}
          aria-label={bgTitle}
          title={
            bgSummary.runningCount > 0
              ? t('common:bgTasks.triggerRunningTitle', { count: bgSummary.runningCount })
              : bgTitle
          }
          onClick={onToggleBgTasks}
        >
          {bgSummary.runningCount > 0 ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          ) : null}
          <BgIcon className="h-3 w-3" />
          {bgSummary.runningCount > 0 ? (
            <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
              {bgSummary.runningCount}
            </span>
          ) : bgSummary.totalCount > 0 ? (
            <span className="tabular-nums opacity-70">{bgSummary.totalCount}</span>
          ) : null}
        </button>
      ) : null}
    </>
  )
}
