import { useTranslation } from 'react-i18next'
import { Check } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import { isCurrentSessionExternallyUpdated } from '@renderer/lib/session-external-update'

/**
 * 会话被外部（如 CLI）更新时的状态徽标：内容已自动同步到视图，仅作提示（不可交互）。
 * 完整手动刷新请用右上角「刷新会话数据」按钮。
 */
export function ComposerExternalUpdateBadge() {
  const { t } = useTranslation()
  const externalUpdateFor = useUIStore((s) => s.externalUpdateFor)
  const active = !!externalUpdateFor && isCurrentSessionExternallyUpdated()
  if (!active) return null
  return (
    <div
      title={t('composer:externalUpdateInfo')}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] text-amber-600"
    >
      <Check className="h-3 w-3" />
      {t('composer:externalUpdate')}
    </div>
  )
}
