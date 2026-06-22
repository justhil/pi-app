import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 冷启动 / 首点会话：Worker 与历史拉取期间的占位 */
export function SessionOpenLoadingView() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 animate-in fade-in duration-200">
      <div className="chat-content-column w-full space-y-3">
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-foreground-secondary/70" aria-hidden />
          <span className="text-[13px] text-foreground-secondary">{t('timeline.loadingSession')}</span>
        </div>
        {[0.78, 0.52, 0.68, 0.44].map((w, i) => (
          <div
            key={i}
            className="h-11 rounded-lg bg-muted/35 animate-pulse"
            style={{
              width: `${w * 100}%`,
              marginLeft: i % 2 === 1 ? 'auto' : 0,
              maxWidth: '88%',
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </div>
    </div>
  )
}