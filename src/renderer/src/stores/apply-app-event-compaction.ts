import type { CompactionEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleCompaction(event: CompactionEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'start') {
    void Promise.all([
      import('@renderer/lib/extension-ui-channel'),
      import('@renderer/stores/extension-ui-store'),
    ]).then(([ch, st]) => {
      ch.clearExtensionDialogDedupe()
      st.useExtensionUIStore.getState().clearAfterRespond()
    })
  } else if (event.phase === 'end') {
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'compaction',
      text: event.summary,
      timestamp: event.timestamp,
    })
  }
}