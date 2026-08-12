import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { applyPiSettingsPatch } from '../pi-settings-patch.js'
import { st } from '../worker-runtime.js'

export async function handleGetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          if (!st.sdk) {
            reply({ type: 'getPiSettings-done', settings: {} })
            return
          }
          const sm = st.session?.settingsManager
            ?? st.sdk.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk.getAgentDir())
          const compaction = sm.getCompactionSettings()
          const retry = sm.getRetrySettings()
          const branchSummary = sm.getBranchSummarySettings()
          reply({
            type: 'getPiSettings-done',
            settings: {
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
              isProjectTrusted: sm.isProjectTrusted(),
              desktopSkillOverrides:
                (sm.getGlobalSettings() as { desktopSkillOverrides?: Record<string, boolean> })
                  ?.desktopSkillOverrides ?? {},
            },
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getPiSettings failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleSetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const sm = st.session?.settingsManager
            ?? st.sdk!.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk!.getAgentDir())
          const patch = msg.patch || {}
          await applyPiSettingsPatch(sm, patch)
          reply({ type: 'setPiSettings-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `setPiSettings failed: ${errorMessage(e)}` })
        }
        return
}

