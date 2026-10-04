import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { SettingRow, SettingsSection, Toggle } from './settings-page-shared'
import { inputCls, selectCls } from './settings-controls'
import { type PiSettingsSnapshot } from './pi-settings-shared'
import { CompactionOverridesControl, ThinkingBudgetsControl } from './pi-settings-model-rows'
import { PI_BUILTIN_TOOLS, resolveDefaultTools, withTool } from './default-tools'

const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** `a >= b` for dotted numeric versions (prerelease tags ignored). */
export function versionAtLeast(version: string | undefined, minimum: string): boolean {
  if (!version) return false
  const parse = (value: string) => value.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(version)
  const b = parse(minimum)
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return true
}

function NumberField({
  value,
  fallback,
  epochKey,
  step,
  width = 'w-[9rem]',
  disabled,
  onCommit,
}: {
  value: unknown
  fallback: number
  epochKey: string
  step: number
  width?: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  return (
    <input
      type="number"
      className={cn(inputCls, width, 'tabular-nums')}
      disabled={disabled}
      key={epochKey}
      defaultValue={String(value ?? fallback)}
      min={0}
      step={step}
      onBlur={(event) => {
        const n = Number(event.target.value)
        if (Number.isFinite(n) && n >= 0) onCommit(Math.floor(n))
      }}
    />
  )
}

export function PiSettingsFormSections({
  ui,
  formEpoch,
  runtimeVersion,
  queuePatch,
}: {
  ui: PiSettingsSnapshot
  formEpoch: number
  /** Version of the pi runtime the desktop currently runs (for "needs pi ≥ x" hints). */
  runtimeVersion?: string
  queuePatch: (p: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const enabledTools = resolveDefaultTools(ui?.defaultTools)
  const needs = (minimum: string): ReactNode =>
    versionAtLeast(runtimeVersion, minimum) ? null : (
      <span className="settings-badge" data-tone="warn" title={t('settings:pi.needsVersionHint', { version: minimum })}>
        {t('settings:pi.needsVersion', { version: minimum })}
      </span>
    )
  return (
    <>
      <SettingsSection title={t('settings:pi.sectionConversation')} description={t('settings:pi.sectionConversationDesc')}>
        <SettingRow label={t('settings:pi.steeringMode')} description={t('settings:pi.steeringModeDesc')} settingKey="steeringMode">
          <select
            className={selectCls}
            value={String(ui?.steeringMode || 'one-at-a-time')}
            disabled={!ui}
            onChange={(e) => queuePatch({ steeringMode: e.target.value })}
          >
            <option value="one-at-a-time">{t('settings:pi.queueOneAtATime')}</option>
            <option value="all">{t('settings:pi.queueAll')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings:pi.followUpMode')} description={t('settings:pi.followUpModeDesc')} settingKey="followUpMode">
          <select
            className={selectCls}
            value={String(ui?.followUpMode || 'one-at-a-time')}
            disabled={!ui}
            onChange={(e) => queuePatch({ followUpMode: e.target.value })}
          >
            <option value="one-at-a-time">{t('settings:pi.queueOneAtATime')}</option>
            <option value="all">{t('settings:pi.queueAll')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings:pi.hideThinking')} description={t('settings:pi.hideThinkingDesc')} settingKey="hideThinkingBlock">
          <Toggle on={!!ui?.hideThinkingBlock} disabled={!ui} onChange={(v) => queuePatch({ hideThinkingBlock: v })} />
        </SettingRow>
        <SettingRow label={t('settings:pi.thinkingBudgets')} description={t('settings:pi.thinkingBudgetsDesc')} settingKey="thinkingBudgets">
          <ThinkingBudgetsControl
            key={`budgets-${formEpoch}`}
            value={ui?.thinkingBudgets}
            disabled={!ui}
            onChange={(next) => queuePatch({ thinkingBudgets: next })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.cacheNotices')} description={t('settings:pi.cacheNoticesDesc')} settingKey="showCacheMissNotices">
          <Toggle on={!!ui?.showCacheMissNotices} disabled={!ui} onChange={(v) => queuePatch({ showCacheMissNotices: v })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionNetwork')} description={t('settings:pi.sectionNetworkDesc')}>
        <SettingRow label={t('settings:pi.transport')} description={t('settings:pi.transportDesc')} settingKey="transport">
          <select
            className={selectCls}
            value={String(ui?.transport || 'auto')}
            disabled={!ui}
            onChange={(e) => queuePatch({ transport: e.target.value })}
          >
            <option value="auto">{t('settings:pi.transportAuto')}</option>
            <option value="sse">SSE</option>
            <option value="websocket">WebSocket</option>
            <option value="websocket-cached">{t('settings:pi.transportWsCached')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings:pi.httpIdleTimeout')} description={t('settings:pi.httpIdleTimeoutDesc')} settingKey="httpIdleTimeoutMs">
          <NumberField
            value={ui?.httpIdleTimeoutMs}
            fallback={300000}
            epochKey={`httpIdle-${formEpoch}`}
            step={1000}
            disabled={!ui}
            onCommit={(n) => queuePatch({ httpIdleTimeoutMs: n })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.wsTimeout')} description={t('settings:pi.wsTimeoutDesc')} settingKey="websocketConnectTimeoutMs">
          <NumberField
            value={ui?.websocketConnectTimeoutMs}
            fallback={15000}
            epochKey={`wsTimeout-${formEpoch}`}
            step={1000}
            disabled={!ui}
            onCommit={(n) => queuePatch({ websocketConnectTimeoutMs: n })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings:pi.cacheWarming')}
          description={t('settings:pi.cacheWarmingDesc')}
          settingKey="cacheWarming"
          badge={needs('0.86.0')}
        >
          <select
            className={selectCls}
            value={String(ui?.cacheWarming || 'streaming')}
            disabled={!ui}
            onChange={(e) => queuePatch({ cacheWarming: e.target.value })}
          >
            <option value="streaming">{t('settings:pi.cacheWarmingStreaming')}</option>
            <option value="idle">{t('settings:pi.cacheWarmingIdle')}</option>
            <option value="off">{t('settings:pi.cacheWarmingOff')}</option>
          </select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionRetry')} description={t('settings:pi.sectionRetryDesc')}>
        <SettingRow label={t('settings:pi.retryEnabled')} description={t('settings:pi.retryEnabledDesc')} settingKey="retry.enabled">
          <Toggle on={ui?.retryEnabled !== false} disabled={!ui} onChange={(v) => queuePatch({ retryEnabled: v })} />
        </SettingRow>
        <SettingRow label={t('settings:pi.retryMax')} description={t('settings:pi.retryMaxDesc')} settingKey="retry.maxRetries">
          <NumberField
            value={ui?.retryMaxRetries}
            fallback={3}
            epochKey={`retryMax-${formEpoch}`}
            step={1}
            width="w-[6rem]"
            disabled={!ui || ui?.retryEnabled === false}
            onCommit={(n) => queuePatch({ retryMaxRetries: n })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.retryDelay')} description={t('settings:pi.retryDelayDesc')} settingKey="retry.baseDelayMs">
          <NumberField
            value={ui?.retryBaseDelayMs}
            fallback={2000}
            epochKey={`retryDelay-${formEpoch}`}
            step={500}
            disabled={!ui || ui?.retryEnabled === false}
            onCommit={(n) => queuePatch({ retryBaseDelayMs: n })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings:pi.retryMaxDelay')}
          description={t('settings:pi.retryMaxDelayDesc')}
          settingKey="retry.maxAgentDelayMs"
          badge={needs('0.86.0')}
        >
          <NumberField
            value={ui?.retryMaxAgentDelayMs}
            fallback={60000}
            epochKey={`retryMaxDelay-${formEpoch}`}
            step={5000}
            disabled={!ui || ui?.retryEnabled === false}
            onCommit={(n) => queuePatch({ retryMaxAgentDelayMs: n })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionCompaction')} description={t('settings:pi.sectionCompactionDesc')}>
        <SettingRow label={t('settings:pi.autoCompaction')} description={t('settings:pi.autoCompactionDesc')} settingKey="compaction.enabled">
          <Toggle
            on={ui?.compactionEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ compactionEnabled: v })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.compactionReserve')} description={t('settings:pi.compactionReserveDesc')} settingKey="compaction.reserveTokens">
          <NumberField
            value={ui?.compactionReserveTokens}
            fallback={16384}
            epochKey={`reserve-${formEpoch}-${ui?.compactionReserveTokens}`}
            step={512}
            disabled={!ui}
            onCommit={(n) => queuePatch({ compactionReserveTokens: n })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.compactionKeep')} description={t('settings:pi.compactionKeepDesc')} settingKey="compaction.keepRecentTokens">
          <NumberField
            value={ui?.compactionKeepRecentTokens}
            fallback={20000}
            epochKey={`keep-${formEpoch}-${ui?.compactionKeepRecentTokens}`}
            step={512}
            disabled={!ui}
            onCommit={(n) => queuePatch({ compactionKeepRecentTokens: n })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings:pi.compactionOverrides')}
          description={t('settings:pi.compactionOverridesDesc')}
          settingKey="compaction.modelOverrides"
          badge={needs('0.86.0')}
        >
          <CompactionOverridesControl
            key={`overrides-${formEpoch}`}
            value={ui?.compactionModelOverrides}
            disabled={!ui}
            onChange={(next) => queuePatch({ compactionModelOverrides: next })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionTools')} description={t('settings:pi.sectionToolsDesc')}>
        <SettingRow label={t('settings:pi.builtinTools')} description={t('settings:pi.builtinToolsDesc')} settingKey="defaultTools">
          <div className="flex max-w-[22rem] flex-wrap justify-end gap-x-3 gap-y-1">
            {[...PI_BUILTIN_TOOLS, ...(IS_WINDOWS ? ['powershell'] : [])].map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-1.5 font-mono text-[12px] text-foreground-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border [accent-color:hsl(var(--foreground))]"
                  disabled={!ui}
                  checked={enabledTools.has(name)}
                  onChange={(e) => queuePatch({ defaultTools: withTool(ui?.defaultTools, name, e.target.checked) })}
                />
                {name}
              </label>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t('settings:pi.codemode')} description={t('settings:pi.codemodeDesc')} settingKey="defaultTools" badge={needs('0.99.0')}>
          <Toggle
            on={enabledTools.has('codemode')}
            disabled={!ui}
            onChange={(v) => queuePatch({ defaultTools: withTool(ui?.defaultTools, 'codemode', v) })}
          />
        </SettingRow>
        {enabledTools.has('codemode') ? (
          <>
          <SettingRow label={t('settings:pi.codemodeMode')} description={t('settings:pi.codemodeModeDesc')} settingKey="codemode.mode">
            <select
              className={selectCls}
              value={String(ui?.codemodeMode || 'on')}
              disabled={!ui}
              onChange={(e) => queuePatch({ codemodeMode: e.target.value })}
            >
              <option value="on">{t('settings:pi.codemodeModeOn')}</option>
              <option value="only">{t('settings:pi.codemodeModeOnly')}</option>
            </select>
          </SettingRow>
          <SettingRow label={t('settings:pi.codemodeBudget')} description={t('settings:pi.codemodeBudgetDesc')} settingKey="codemode.inlineBudget">
            <NumberField
              value={ui?.codemodeInlineBudget}
              fallback={3000}
              epochKey={`codemodeBudget-${formEpoch}`}
              step={500}
              disabled={!ui}
              onCommit={(n) => queuePatch({ codemodeInlineBudget: n })}
            />
          </SettingRow>
          </>
        ) : null}
        <SettingRow label={t('settings:pi.toolSearch')} description={t('settings:pi.toolSearchDesc')} settingKey="defaultTools" badge={needs('0.99.0')}>
          <Toggle
            on={enabledTools.has('tool_search')}
            disabled={!ui}
            onChange={(v) => queuePatch({ defaultTools: withTool(ui?.defaultTools, 'tool_search', v) })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionToolShell')} description={t('settings:pi.sectionToolShellDesc')}>
        <SettingRow label={t('settings:pi.shellPath')} description={t('settings:pi.shellPathDesc')} settingKey="shellPath">
          <input
            className={cn(inputCls, 'w-[min(18rem,60vw)]')}
            disabled={!ui}
            key={`shellPath-${formEpoch}`}
            placeholder={t('settings:pi.shellPathPlaceholder')}
            defaultValue={String(ui?.shellPath || '')}
            onBlur={(e) => queuePatch({ shellPath: e.target.value || undefined })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.shellPrefix')} description={t('settings:pi.shellPrefixDesc')} settingKey="shellCommandPrefix">
          <input
            className={cn(inputCls, 'w-[min(18rem,60vw)] font-mono text-[12px]')}
            disabled={!ui}
            key={`shellPrefix-${formEpoch}`}
            placeholder={t('settings:pi.shellPrefixPlaceholder')}
            defaultValue={String(ui?.shellCommandPrefix || '')}
            onBlur={(e) => queuePatch({ shellCommandPrefix: e.target.value || undefined })}
          />
        </SettingRow>
        <SettingRow label={t('settings:pi.npmCommand')} description={t('settings:pi.npmCommandDesc')} settingKey="npmCommand">
          <input
            className={cn(inputCls, 'w-[min(18rem,60vw)] font-mono text-[12px]')}
            disabled={!ui}
            key={`npm-${formEpoch}`}
            defaultValue={Array.isArray(ui?.npmCommand) ? (ui.npmCommand as string[]).join(' ') : String(ui?.npmCommand || '')}
            placeholder="npm"
            onBlur={(e) => {
              const parts = e.target.value.trim().split(/\s+/).filter(Boolean)
              queuePatch({ npmCommand: parts.length ? parts : undefined })
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionImages')} description={t('settings:pi.sectionImagesDesc')}>
        <SettingRow label={t('settings:pi.imageAutoResize')} description={t('settings:pi.imageAutoResizeDesc')} settingKey="images.autoResize">
          <Toggle on={ui?.imageAutoResize !== false} disabled={!ui} onChange={(v) => queuePatch({ imageAutoResize: v })} />
        </SettingRow>
        <SettingRow label={t('settings:pi.blockImages')} description={t('settings:pi.blockImagesDesc')} settingKey="images.blockImages">
          <Toggle on={!!ui?.blockImages} disabled={!ui} onChange={(v) => queuePatch({ blockImages: v })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:pi.sectionTrust')} description={t('settings:pi.sectionTrustDesc')}>
        <SettingRow label={t('settings:pi.defaultProjectTrust')} description={t('settings:pi.defaultProjectTrustDesc')} settingKey="defaultProjectTrust">
          <select
            className={selectCls}
            value={String(ui?.defaultProjectTrust || 'ask')}
            disabled={!ui}
            onChange={(e) => queuePatch({ defaultProjectTrust: e.target.value })}
          >
            <option value="ask">{t('settings:pi.trustAsk')}</option>
            <option value="always">{t('settings:pi.trustAlways')}</option>
            <option value="never">{t('settings:pi.trustNever')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('settings:pi.skillCommands')} description={t('settings:pi.skillCommandsDesc')} settingKey="enableSkillCommands">
          <Toggle
            on={ui?.enableSkillCommands !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ enableSkillCommands: v })}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
