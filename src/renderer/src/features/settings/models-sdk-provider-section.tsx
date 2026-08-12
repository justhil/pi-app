import { useTranslation } from 'react-i18next'
import { Layers } from '@renderer/components/icons'
import type { ModelInfo } from '@shared/ipc-contract'
import { ProviderAvatar } from './models-settings-shared'

interface ModelsSdkProviderSectionProps {
  providerIds: string[]
  modelsByProvider: Record<string, ModelInfo[]>
}

export function ModelsSdkProviderSection({
  providerIds,
  modelsByProvider,
}: ModelsSdkProviderSectionProps) {
  const { t } = useTranslation('settings')

  return (
    <section className="space-y-3 border-t border-border/40 pt-5" data-testid="sdk-provider-section">
      <div className="flex items-start gap-2.5">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{t('models.sdkProvidersTitle')}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t('models.sdkProvidersDescription', { count: providerIds.length })}
          </p>
        </div>
      </div>

      {providerIds.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/50 px-3 py-3 text-sm text-muted-foreground">
          {t('models.sdkProvidersEmpty')}
        </p>
      ) : (
        <div className="space-y-2">
          {providerIds.map((providerId) => {
            const models = modelsByProvider[providerId]
            const auth = models.find((model) => model.auth)?.auth
            const authDetail = auth?.supported
              ? auth.configured
                ? [
                  auth.type === 'oauth'
                    ? t('models.authTypeOAuth')
                    : auth.type === 'api_key'
                      ? t('models.authTypeApiKey')
                      : null,
                  auth.source || null,
                ].filter(Boolean).join(' · ')
                : t('models.authNotConfigured')
              : t('models.authUnavailable')

            return (
              <details
                key={providerId}
                className="ui-enter rounded-lg border border-border/60 bg-muted/15 px-4 py-3"
                open={providerIds.length <= 3}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center gap-3">
                    <ProviderAvatar label={providerId} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold text-foreground">{providerId}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('models.sdkAvailableModelCount', { count: models.length })}
                      </div>
                      <div className="mt-0.5 text-2xs text-muted-foreground">
                        {t('models.sdkManagedReadOnly')} · {authDetail}
                      </div>
                    </div>
                  </div>
                </summary>
                <ul className="mt-3 grid max-h-[min(280px,42vh)] gap-1 overflow-y-auto sm:grid-cols-2">
                  {models.map((model) => (
                    <li
                      key={model.id}
                      className="truncate rounded-md bg-muted/35 px-2.5 py-1.5 font-mono text-xs text-foreground/80"
                      title={model.id}
                    >
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
