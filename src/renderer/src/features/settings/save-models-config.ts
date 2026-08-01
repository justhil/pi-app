import type { PiModelsConfigPayload } from '@shared/ipc-contract'

export async function saveModelsConfigDraft(
  draft: PiModelsConfigPayload,
  actions: {
    setConfig: (config: PiModelsConfigPayload) => Promise<{ ok: boolean; error?: string }>
    reload: () => Promise<void>
  },
): Promise<void> {
  const response = await actions.setConfig(draft)
  if (!response.ok) throw new Error(response.error || 'SAVE_FAILED')
  await actions.reload()
}
