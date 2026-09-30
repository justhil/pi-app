// Embedded extension config subpage (v2-only). All metadata from adapter.json catalog.

import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AdapterConfigPanel } from './adapter-config-panel'
import { CUSTOM_CONFIG_RENDERERS } from './custom-config-renderers'
import { resolveAdapterText } from '@extension-compat/adapter-schema'
import { useAdapterCatalog } from '@renderer/lib/adapter-catalog'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'

export function ExtensionConfigSubpage({ extensionId }: { extensionId: string }) {
  const { t, i18n } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const catalog = useAdapterCatalog(workspace || '')
  const loading = !catalog
  const jsonAdapter = catalog?.adapters.find((adapter) => adapter.id === extensionId || adapter.match.names?.includes(extensionId)) ?? null

  if (loading) return <div className="text-sm text-muted-foreground/70">{t('common:loading')}</div>

  const info = jsonAdapter
    ? (() => {
        const r = resolveAdapterText(jsonAdapter, i18n.language)
        return {
          displayName: r.displayName || extensionId,
          description: r.description,
          tools: jsonAdapter.match?.tools || [],
          commands: Array.from(
            new Set([
              ...Object.keys(jsonAdapter.slash || {}),
              ...(jsonAdapter.match?.commands || []).map((c) => (c.startsWith('/') ? c : `/${c}`)),
            ]),
          ),
        }
      })()
    : { displayName: extensionId, description: '', tools: [], commands: [] }

  // Dynamic specialized renderer (skills-manager / mcp) takes precedence when declared.
  const CustomRenderer = jsonAdapter?.config?.customRenderer
    ? CUSTOM_CONFIG_RENDERERS[jsonAdapter.config.customRenderer]
    : null

  const saveAppLocal = async (next: Record<string, unknown>) => {
    try {
      await ipcClient.invoke('extension.config.set', { extensionId, workspaceId: workspace || '', config: next })
    } catch (e) {
      console.error('extension.config.set failed:', e)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={info.displayName} description={info.description} />

      {jsonAdapter ? (
        CustomRenderer ? (
          <CustomRenderer extensionId={extensionId} workspace={workspace || ''} onChange={saveAppLocal} />
        ) : (
          <AdapterConfigPanel key={`${workspace}:${jsonAdapter.id}:${catalog?.revision}`} adapter={jsonAdapter} />
        )
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
          <div className="text-base font-medium text-foreground/80">{t('extension:unregisteredAdapter')}</div>
          <div className="mt-1 text-sm text-muted-foreground/70">
            {t('extension:noAdapterHint')}
          </div>
        </div>
      )}

      {info.tools.length > 0 && (
        <div>
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">{t('extension:registeredTools')}</div>
          <div className="flex flex-wrap gap-1">
            {info.tools.map((t) => (
              <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-2xs">{t}</span>
            ))}
          </div>
        </div>
      )}

      {info.commands.length > 0 && (
        <div>
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/50">{t('extension:registeredCommands')}</div>
          <div className="flex flex-wrap gap-1">
            {info.commands.map((c) => (
              <span key={c} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-2xs">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
