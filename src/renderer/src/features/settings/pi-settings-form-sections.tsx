import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  Section,
  Row,
  Toggle,
  selectCls,
  inputCls,
  type PiSettingsSnapshot,
} from './pi-settings-shared'

export function PiSettingsFormSections({
  ui,
  formEpoch,
  thinkingOpts,
  modelOptions,
  currentModelKey,
  onModelSelect,
  queuePatch,
}: {
  ui: PiSettingsSnapshot
  formEpoch: number
  thinkingOpts: { v: string; l: string }[]
  modelOptions: Array<{ id: string; name?: string; provider?: string; available?: boolean }>
  currentModelKey: string
  onModelSelect: (key: string) => void
  queuePatch: (p: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Section title={t('settings:pi.sectionModelInference')}>
        <Row label={t('settings:pi.defaultModel')} description={t('settings:pi.defaultModelDesc')}>
          <select
            className={cn(selectCls, 'min-w-[min(280px,70vw)]')}
            value={currentModelKey}
            disabled={!ui || modelOptions.length === 0}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            <option value="">{t('settings:pi.notSet')}</option>
            {modelOptions.map((m) => {
              const key = `${m.provider}/${m.id}`
              const label = m.name && m.name !== m.id ? `${key} — ${m.name}` : key
              return (
                <option key={key} value={key}>
                  {label}
                </option>
              )
            })}
          </select>
        </Row>
        <Row label={t('settings:pi.defaultThinking')} description={t('settings:pi.defaultThinkingDesc')}>
          <select
            className={selectCls}
            value={String(ui?.defaultThinkingLevel || 'medium')}
            disabled={!ui}
            onChange={(e) => queuePatch({ defaultThinkingLevel: e.target.value })}
          >
            {thinkingOpts.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l} ({o.v})
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings:pi.modelWhitelist')} description={t('settings:pi.modelWhitelistDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`enabledModels-${formEpoch}`}
            defaultValue={Array.isArray(ui?.enabledModels) ? (ui.enabledModels as string[]).join(', ') : ''}
            placeholder={t('settings:pi.modelWhitelistPlaceholder')}
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const patterns = raw ? raw.split(/,\s*/).filter(Boolean) : undefined
              queuePatch({ enabledModels: patterns })
            }}
          />
        </Row>
        <Row label={t('settings:pi.hideThinking')} description={t('settings:pi.hideThinkingDesc')}>
          <Toggle on={!!ui?.hideThinkingBlock} disabled={!ui} onChange={(v) => queuePatch({ hideThinkingBlock: v })} />
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionQueueTransport')}>
        <Row label={t('settings:pi.steeringMode')} description={t('settings:pi.steeringModeDesc')}>
          <select
            className={selectCls}
            value={String(ui?.steeringMode || 'all')}
            disabled={!ui}
            onChange={(e) => queuePatch({ steeringMode: e.target.value })}
          >
            <option value="all">{t('settings:pi.steeringAll')}</option>
            <option value="one-at-a-time">{t('settings:pi.steeringOneAtATime')}</option>
          </select>
        </Row>
        <Row label={t('settings:pi.followUpMode')} description={t('settings:pi.followUpModeDesc')}>
          <select
            className={selectCls}
            value={String(ui?.followUpMode || 'all')}
            disabled={!ui}
            onChange={(e) => queuePatch({ followUpMode: e.target.value })}
          >
            <option value="all">all</option>
            <option value="one-at-a-time">one-at-a-time</option>
          </select>
        </Row>
        <Row label={t('settings:pi.transport')} description={t('settings:pi.transportDesc')}>
          <select
            className={selectCls}
            value={String(ui?.transport || 'auto')}
            disabled={!ui}
            onChange={(e) => queuePatch({ transport: e.target.value })}
          >
            <option value="auto">auto</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </Row>
        <Row
          label={t('settings:pi.httpIdleTimeout')}
          description={t('settings:pi.httpIdleTimeoutDesc', { ms: ui?.httpIdleTimeoutMs ?? '—' })}
        >
          <input
            type="number"
            className={cn(inputCls, 'max-w-[8rem]')}
            disabled={!ui}
            key={`httpIdle-${formEpoch}`}
            defaultValue={String(ui?.httpIdleTimeoutMs ?? '')}
            min={0}
            step={1000}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0) queuePatch({ httpIdleTimeoutMs: n })
            }}
          />
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionCompactionRetry')}>
        <Row label={t('settings:pi.autoCompaction')} description={t('settings:pi.autoCompactionDesc')}>
          <Toggle
            on={ui?.compactionEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ compactionEnabled: v })}
          />
        </Row>
        <Row label={t('settings:pi.compactionReserve')} description={t('settings:pi.compactionReserveDesc')}>
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!ui}
            key={`reserve-${formEpoch}-${ui?.compactionReserveTokens}`}
            defaultValue={String(ui?.compactionReserveTokens ?? 16384)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              queuePatch({ compactionReserveTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label={t('settings:pi.compactionKeep')} description={t('settings:pi.compactionKeepDesc')}>
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!ui}
            key={`keep-${formEpoch}-${ui?.compactionKeepRecentTokens}`}
            defaultValue={String(ui?.compactionKeepRecentTokens ?? 20000)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              queuePatch({ compactionKeepRecentTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label={t('settings:pi.retryEnabled')} description={t('settings:pi.retryEnabledDesc')}>
          <Toggle on={ui?.retryEnabled !== false} disabled={!ui} onChange={(v) => queuePatch({ retryEnabled: v })} />
        </Row>
        <Row label={t('settings:pi.retryParams')} description={t('settings:pi.retryParamsDesc')}>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('settings:pi.retryParamsValue', { max: String(ui?.retryMaxRetries), delay: String(ui?.retryBaseDelayMs) })}
          </span>
        </Row>
        <Row label={t('settings:pi.branchSummary')} description={t('settings:pi.branchSummaryDesc')}>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('settings:pi.branchSummaryValue', {
              reserve: String(ui?.branchSummaryReserveTokens),
              skip: ui?.branchSummarySkipPrompt ? t('settings:pi.yes') : t('settings:pi.no'),
            })}
          </span>
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionToolShell')}>
        <Row label={t('settings:pi.shellPath')} description={t('settings:pi.shellPathDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPath-${formEpoch}`}
            placeholder={t('settings:pi.shellPathPlaceholder')}
            defaultValue={String(ui?.shellPath || '')}
            onBlur={(e) => queuePatch({ shellPath: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.shellPrefix')} description={t('settings:pi.shellPrefixDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPrefix-${formEpoch}`}
            defaultValue={String(ui?.shellCommandPrefix || '')}
            onBlur={(e) => queuePatch({ shellCommandPrefix: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.npmCommand')} description={t('settings:pi.npmCommandDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`npm-${formEpoch}`}
            defaultValue={String(ui?.npmCommand || '')}
            placeholder="npm"
            onBlur={(e) => queuePatch({ npmCommand: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.imageAutoResize')} description={t('settings:pi.imageAutoResizeDesc')}>
          <Toggle on={!!ui?.imageAutoResize} disabled={!ui} onChange={(v) => queuePatch({ imageAutoResize: v })} />
        </Row>
        <Row label={t('settings:pi.showImages')} description={t('settings:pi.showImagesDesc')}>
          <Toggle on={ui?.showImages !== false} disabled={!ui} onChange={(v) => queuePatch({ showImages: v })} />
        </Row>
        <Row label={t('settings:pi.blockImages')} description={t('settings:pi.blockImagesDesc')}>
          <Toggle on={!!ui?.blockImages} disabled={!ui} onChange={(v) => queuePatch({ blockImages: v })} />
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionSkillStartup')}>
        <Row label={t('settings:pi.defaultProjectTrust')} description={t('settings:pi.defaultProjectTrustDesc')}>
          <select
            className={selectCls}
            value={String(ui?.defaultProjectTrust || 'ask')}
            disabled={!ui}
            onChange={(e) => queuePatch({ defaultProjectTrust: e.target.value })}
          >
            <option value="ask">ask</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </Row>
        <Row label={t('settings:pi.skillCommands')} description={t('settings:pi.skillCommandsDesc')}>
          <Toggle
            on={ui?.enableSkillCommands !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ enableSkillCommands: v })}
          />
        </Row>
        <Row label={t('settings:pi.quietStartup')} description={t('settings:pi.quietStartupDesc')}>
          <Toggle on={!!ui?.quietStartup} disabled={!ui} onChange={(v) => queuePatch({ quietStartup: v })} />
        </Row>
      </Section>
    </>
  )
}