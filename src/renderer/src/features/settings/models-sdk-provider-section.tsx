import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
import type { ModelInfo } from '@shared/ipc-contract'
import { cn } from '@renderer/lib/utils'

interface ModelsSdkProviderSectionProps {
  providerIds: string[]
  modelsByProvider: Record<string, ModelInfo[]>
}

/** The active SDK's built-in providers: read-only, one compact row each, signed-in ones first. */
export function ModelsSdkProviderSection({ providerIds, modelsByProvider }: ModelsSdkProviderSectionProps) {
  const { t } = useTranslation('settings')
  const authOf = (id: string) => modelsByProvider[id]?.find((model) => model.auth)?.auth
  const ordered = [...providerIds].sort((a, b) => Number(!!authOf(b)?.configured) - Number(!!authOf(a)?.configured))

  return (
    <section className="settings-section" data-testid="sdk-provider-section">
      <div className="mb-2.5 px-1">
        <h3 className="text-[13.5px] font-semibold leading-5 text-foreground">{t('models.sdkProvidersTitle')}</h3>
        <p className="mt-0.5 text-[12.5px] leading-[1.6] text-foreground-secondary">{t('models.sdkProvidersDescription', { count: providerIds.length })}</p>
      </div>

      {providerIds.length === 0 ? (
        <p className="settings-card px-4 py-3 text-[12.5px] text-foreground-secondary">{t('models.sdkProvidersEmpty')}</p>
      ) : (
        <div className="settings-card">
          {ordered.map((providerId) => {
            const models = modelsByProvider[providerId]
            const auth = authOf(providerId)
            const configured = !!auth?.supported && !!auth.configured
            const authDetail = auth?.supported
              ? auth.configured
                ? [auth.type === 'oauth' ? t('models.authTypeOAuth') : auth.type === 'api_key' ? t('models.authTypeApiKey') : null, auth.source || null]
                    .filter(Boolean)
                    .join(' · ')
                : t('models.authNotConfigured')
              : t('models.authUnavailable')

            return (
              <details key={providerId} className="group" data-sdk-provider={providerId}>
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-hover)]/40">
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground-secondary transition-transform group-open:rotate-90" strokeWidth={2} />
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', configured ? 'bg-emerald-500/80' : 'bg-foreground/15')} />
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">{providerId}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-foreground-secondary">{t('models.sdkAvailableModelCount', { count: models.length })}</span>
                  <span className={cn('ml-auto shrink-0 truncate text-[12px]', configured ? 'text-foreground' : 'text-foreground-secondary')}>{authDetail}</span>
                </summary>
                <ul className="grid max-h-[min(260px,40vh)] gap-x-4 gap-y-0.5 overflow-y-auto px-4 pb-3 pl-[2.6rem] sm:grid-cols-2">
                  {models.map((model) => (
                    <li key={model.id} className="truncate font-mono text-[11.5px] text-foreground-secondary" title={model.id}>
                      {model.id}
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
