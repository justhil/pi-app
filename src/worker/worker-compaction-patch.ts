/** Pi SettingsManager has getters but no setters for compaction token fields — write via globalSettings + markModified. */
export type CompactionTokenPatch = {
  compactionReserveTokens?: unknown
  compactionKeepRecentTokens?: unknown
}

export type SettingsManagerLike = {
  globalSettings: Record<string, unknown> & { compaction?: Record<string, unknown> }
  markModified: (section: string, field: string) => void
  save: () => void
}

export function patchPiCompactionTokens(sm: SettingsManagerLike, patch: CompactionTokenPatch): void {
  const gs = sm.globalSettings
  if (!gs.compaction) gs.compaction = {}
  if (patch.compactionReserveTokens !== undefined) {
    const n = Math.floor(Number(patch.compactionReserveTokens))
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid compaction.reserveTokens')
    gs.compaction.reserveTokens = n
    sm.markModified('compaction', 'reserveTokens')
  }
  if (patch.compactionKeepRecentTokens !== undefined) {
    const n = Math.floor(Number(patch.compactionKeepRecentTokens))
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid compaction.keepRecentTokens')
    gs.compaction.keepRecentTokens = n
    sm.markModified('compaction', 'keepRecentTokens')
  }
  if (patch.compactionReserveTokens !== undefined || patch.compactionKeepRecentTokens !== undefined) {
    sm.save()
  }
}