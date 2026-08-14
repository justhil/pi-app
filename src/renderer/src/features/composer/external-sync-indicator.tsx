import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'

/**
 * 外部（如 CLI）会话同步指示器：
 * - active：外部对话进行中，绿色动效（写入活跃时持续，约 5s 无写入后隐藏）
 * - error：同步异常，橙/红色，点击重试
 * - idle：不渲染
 */
export function ExternalSyncIndicator() {
  const { t } = useTranslation()
  const phase = useUIStore((s) => s.externalSyncPhase)
  if (phase === 'idle') return null

  if (phase === 'error') {
    return (
      <button
        type="button"
        onClick={() => void reloadCurrentSessionData()}
        title={t('common:composer.externalSyncErrorRetry')}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 text-[11px] text-red-600 transition-colors hover:bg-red-500/20"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {t('common:composer.externalSyncError')}
        <RefreshCw className="h-3 w-3 opacity-70" />
      </button>
    )
  }

  return (
    <div
      title={t('common:composer.externalSyncActiveInfo')}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] text-emerald-600"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {t('common:composer.externalSyncActive')}
    </div>
  )
}
