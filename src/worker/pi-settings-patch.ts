import type { SettingsManager } from '@earendil-works/pi-coding-agent'
import { patchPiCompactionTokens, type SettingsManagerLike } from './worker-compaction-patch'

export async function applyPiSettingsPatch(
  sm: SettingsManager,
  patch: Record<string, unknown>,
): Promise<void> {
  if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
    sm.setDefaultModelAndProvider(String(patch.defaultProvider), String(patch.defaultModel))
  } else if (patch.defaultProvider !== undefined) sm.setDefaultProvider(String(patch.defaultProvider))
  else if (patch.defaultModel !== undefined) sm.setDefaultModel(String(patch.defaultModel))

  if (patch.defaultThinkingLevel !== undefined) {
    sm.setDefaultThinkingLevel(patch.defaultThinkingLevel as Parameters<typeof sm.setDefaultThinkingLevel>[0])
  }
  if (patch.steeringMode !== undefined) {
    sm.setSteeringMode(patch.steeringMode as Parameters<typeof sm.setSteeringMode>[0])
  }
  if (patch.followUpMode !== undefined) {
    sm.setFollowUpMode(patch.followUpMode as Parameters<typeof sm.setFollowUpMode>[0])
  }
  if (patch.transport !== undefined) {
    sm.setTransport(patch.transport as Parameters<typeof sm.setTransport>[0])
  }
  if (patch.compactionEnabled !== undefined) sm.setCompactionEnabled(Boolean(patch.compactionEnabled))
  patchPiCompactionTokens(sm as unknown as SettingsManagerLike, patch)
  if (patch.shellPath !== undefined) {
    sm.setShellPath(typeof patch.shellPath === 'string' ? patch.shellPath : undefined)
  }
  if (patch.imageAutoResize !== undefined) sm.setImageAutoResize(Boolean(patch.imageAutoResize))
  if (patch.enabledModels !== undefined) {
    sm.setEnabledModels(Array.isArray(patch.enabledModels) ? (patch.enabledModels as string[]) : undefined)
  }
  if (patch.retryEnabled !== undefined) sm.setRetryEnabled(Boolean(patch.retryEnabled))
  if (patch.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(Boolean(patch.hideThinkingBlock))
  if (patch.showImages !== undefined) sm.setShowImages(Boolean(patch.showImages))
  if (patch.blockImages !== undefined) sm.setBlockImages(Boolean(patch.blockImages))
  if (patch.enableSkillCommands !== undefined) sm.setEnableSkillCommands(Boolean(patch.enableSkillCommands))
  if (patch.quietStartup !== undefined) sm.setQuietStartup(Boolean(patch.quietStartup))
  if (patch.defaultProjectTrust !== undefined) {
    sm.setDefaultProjectTrust(patch.defaultProjectTrust as Parameters<typeof sm.setDefaultProjectTrust>[0])
  }
  if (patch.shellCommandPrefix !== undefined) {
    sm.setShellCommandPrefix(
      typeof patch.shellCommandPrefix === 'string' ? patch.shellCommandPrefix : undefined,
    )
  }
  if (patch.npmCommand !== undefined) {
    sm.setNpmCommand(patch.npmCommand as Parameters<typeof sm.setNpmCommand>[0])
  }
  if (patch.treeFilterMode !== undefined) {
    sm.setTreeFilterMode(patch.treeFilterMode as Parameters<typeof sm.setTreeFilterMode>[0])
  }
  if (patch.doubleEscapeAction !== undefined) {
    sm.setDoubleEscapeAction(
      patch.doubleEscapeAction as Parameters<typeof sm.setDoubleEscapeAction>[0],
    )
  }
  if (patch.httpIdleTimeoutMs !== undefined) sm.setHttpIdleTimeoutMs(Number(patch.httpIdleTimeoutMs))
  if (patch.isProjectTrusted === true) sm.setProjectTrusted(true)
  if (patch.isProjectTrusted === false) sm.setProjectTrusted(false)
  await sm.flush()
  const errors = sm.drainErrors().filter((entry) => entry.scope === 'global')
  if (errors.length > 0) throw errors[0].error
}
