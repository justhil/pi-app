/**
 * The flat pi settings shape the desktop settings pages read. Shared by the session worker and the
 * preview process so both answer `pi.settings.get` identically (the preview serves it while no
 * worker is running, e.g. right after launch in a temp-chat draft).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- SettingsManager comes from whichever pi SDK is active */
type AnySettingsManager = any

function globalField<T>(sm: AnySettingsManager, key: string): T | undefined {
  const global = sm.getGlobalSettings?.() as Record<string, unknown> | undefined
  return global?.[key] as T | undefined
}

/** Re-read settings.json so edits made elsewhere (terminal pi, another process) are not masked. */
export async function refreshSettingsManager(sm: AnySettingsManager): Promise<void> {
  try {
    await sm.flush?.()
    await sm.reload?.()
  } catch {
    /* keep the in-memory view */
  }
}

export function piSettingsSnapshot(sm: AnySettingsManager): Record<string, unknown> {
  const compaction = sm.getCompactionSettings()
  const retry = sm.getRetrySettings()
  const branchSummary = sm.getBranchSummarySettings()
  return {
    defaultProvider: sm.getDefaultProvider(),
    defaultModel: sm.getDefaultModel(),
    defaultThinkingLevel: sm.getDefaultThinkingLevel(),
    steeringMode: sm.getSteeringMode(),
    followUpMode: sm.getFollowUpMode(),
    transport: sm.getTransport(),
    compactionEnabled: compaction.enabled,
    compactionReserveTokens: compaction.reserveTokens,
    compactionKeepRecentTokens: compaction.keepRecentTokens,
    retryEnabled: retry.enabled,
    retryMaxRetries: retry.maxRetries,
    retryBaseDelayMs: retry.baseDelayMs,
    branchSummaryReserveTokens: branchSummary.reserveTokens,
    branchSummarySkipPrompt: branchSummary.skipPrompt,
    httpIdleTimeoutMs: sm.getHttpIdleTimeoutMs(),
    shellPath: sm.getShellPath(),
    shellCommandPrefix: sm.getShellCommandPrefix(),
    npmCommand: sm.getNpmCommand(),
    imageAutoResize: sm.getImageAutoResize(),
    showImages: sm.getShowImages(),
    blockImages: sm.getBlockImages(),
    hideThinkingBlock: sm.getHideThinkingBlock(),
    enableSkillCommands: sm.getEnableSkillCommands(),
    quietStartup: sm.getQuietStartup(),
    defaultProjectTrust: sm.getDefaultProjectTrust(),
    treeFilterMode: sm.getTreeFilterMode(),
    doubleEscapeAction: sm.getDoubleEscapeAction(),
    enabledModels: sm.getEnabledModels(),
    packages: sm.getPackages(),
    extensionPaths: sm.getExtensionPaths(),
    skillPaths: sm.getSkillPaths(),
    sessionDir: sm.getSessionDir(),
    isProjectTrusted: sm.isProjectTrusted?.(),
    showCacheMissNotices: sm.getShowCacheMissNotices?.() ?? false,
    websocketConnectTimeoutMs: sm.getWebSocketConnectTimeoutMs?.(),
    retryMaxAgentDelayMs: globalField<{ maxAgentDelayMs?: number }>(sm, 'retry')?.maxAgentDelayMs,
    cacheWarming: globalField<string>(sm, 'cacheWarming'),
    modelThinkingLevels: globalField<Record<string, string>>(sm, 'modelThinkingLevels') ?? {},
    desktopSkillOverrides: globalField<Record<string, boolean>>(sm, 'desktopSkillOverrides') ?? {},
  }
}

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})

/**
 * Last-resort flattening of a raw settings.json when no SDK process can answer. Unset keys stay
 * undefined so the UI shows its defaults only for values the user truly never set.
 */
export function flattenRawPiSettings(raw: Raw): Raw {
  const compaction = obj(raw.compaction)
  const retry = obj(raw.retry)
  const branchSummary = obj(raw.branchSummary)
  const images = obj(raw.images)
  const terminal = obj(raw.terminal)
  return {
    ...raw,
    compactionEnabled: compaction.enabled,
    compactionReserveTokens: compaction.reserveTokens,
    compactionKeepRecentTokens: compaction.keepRecentTokens,
    retryEnabled: retry.enabled,
    retryMaxRetries: retry.maxRetries,
    retryBaseDelayMs: retry.baseDelayMs,
    retryMaxAgentDelayMs: retry.maxAgentDelayMs,
    branchSummaryReserveTokens: branchSummary.reserveTokens,
    branchSummarySkipPrompt: branchSummary.skipPrompt,
    imageAutoResize: images.autoResize,
    blockImages: images.blockImages,
    showImages: terminal.showImages,
    extensionPaths: raw.extensions,
    skillPaths: raw.skills,
    modelThinkingLevels: obj(raw.modelThinkingLevels),
    desktopSkillOverrides: obj(raw.desktopSkillOverrides),
  }
}
