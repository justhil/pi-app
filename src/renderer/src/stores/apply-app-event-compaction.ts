import type { CompactionEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleCompaction(event: CompactionEvent, api: StoreApi): void {
  const state = api.get()
  // 压缩状态按会话键控：A 压缩中切到 B，B 不得错显；A 的 end 转后台也要能清掉
  const sessionFile = event.sessionFile ?? null
  if (event.phase === 'start') {
    state.setCompactingSession(sessionFile, true)
    void Promise.all([
      import('@renderer/lib/extension-ui-channel'),
      import('@renderer/stores/extension-ui-store'),
    ]).then(([ch, st]) => {
      ch.clearExtensionDialogDedupe()
      st.useExtensionUIStore.getState().clearAfterRespond()
    })
  } else if (event.phase === 'end') {
    state.setCompactingSession(sessionFile, false)
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'compaction',
      text: event.summary,
      timestamp: event.timestamp,
    })
  }
}
