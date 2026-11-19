import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AGENT_PURGE_MODES,
  assessMidSessionPurgeCacheImpact,
  detectPurgeStrategyPreset,
  PURGE_CIPHER_LEVELS,
  PURGE_THINKING_GUIDANCES,
  personaCopy,
  personaLanguage,
  strategyForPreset,
  type AgentPurgeMode,
  type PurgeCipherLevel,
  type PurgeHistoryMode,
  type PurgeMidSessionImpactReason,
  type PurgeStrategyOptions,
  type PurgeThinkingGuidance,
} from '@shared/agent-purge'
import { AlertTriangle, Bot, Check, ChevronDown, Settings } from '@renderer/components/icons'
import {
  peekAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import {
  loadAgentPurgeState,
  openSettingsToPage,
  resolveComposerPurgeState,
  setDraftPurgeEnabled,
  setDraftPurgeMode,
  setDraftPurgePersona,
  setDraftPurgeStrategy,
  syncPurgeDraftContextKey,
  updateSessionPurge,
  useAgentPurgeStore,
} from '@renderer/lib/agent-purge-store'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerPopover } from './composer-popover'

function shortPersonaLabel(name: string): string {
  const head = name.split(/[·—–-]/)[0]?.trim() || name.trim()
  return head.length > 10 ? `${head.slice(0, 9)}…` : head
}

interface PendingMidSessionChange {
  enabled: boolean
  personaId: string
  mode: AgentPurgeMode
  strategy: PurgeStrategyOptions
  reasons: PurgeMidSessionImpactReason[]
}

export function ComposerPurgeToggle({
  draftContextKey,
  running,
}: {
  draftContextKey: string
  running?: boolean
}) {
  const { t, i18n } = useTranslation()
  const lang = personaLanguage(i18n.language)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingMidSessionChange | null>(null)
  const [tailInfoBanner, setTailInfoBanner] = useState(false)

  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const timelineLength = useUIStore((s) => s.timelineItems.length)
  const optimisticPendingUserText = useUIStore((s) => s.optimisticPendingUserText)
  const currentModelKey = useUIStore((s) => s.runState.model)
  const [modelsList, setModelsList] = useState(() => peekAvailableModels())

  useEffect(() => subscribeAvailableModels(setModelsList), [])

  const activeModelApi = modelsList.find((m) => `${m.provider}/${m.id}` === currentModelKey)?.api
  const tunnelDowngradedApi =
    activeModelApi && activeModelApi !== 'openai-completions' ? activeModelApi : null

  const config = useAgentPurgeStore((s) => s.config)
  const purgedSessions = useAgentPurgeStore((s) => s.purgedSessions)
  const draftEnabled = useAgentPurgeStore((s) => s.draftEnabled)
  const draftPersonaId = useAgentPurgeStore((s) => s.draftPersonaId)
  const draftMode = useAgentPurgeStore((s) => s.draftMode)
  const draftStrategy = useAgentPurgeStore((s) => s.draftStrategy)
  const pendingLock = useAgentPurgeStore((s) => s.pendingLock)

  useEffect(() => {
    void loadAgentPurgeState()
  }, [])

  useEffect(() => {
    if (!historySessionFile) return
    const st = useAgentPurgeStore.getState()
    if (!st.loaded) void loadAgentPurgeState()
  }, [historySessionFile])

  useEffect(() => {
    syncPurgeDraftContextKey(draftContextKey)
    setMenuOpen(false)
    setPendingConfirm(null)
    setTailInfoBanner(false)
  }, [draftContextKey])

  const uiState = resolveComposerPurgeState({
    historySessionFile,
    timelineLength,
    optimisticPendingUserText,
    isRunning: !!running,
    config,
    purgedSessions,
    draftEnabled,
    draftPersonaId,
    draftMode,
    draftStrategy,
    pendingLock,
  })

  const active = uiState.checked
  const midSession = uiState.midSession
  const strategy = uiState.strategy
  const activePreset = detectPurgeStrategyPreset(strategy)
  const currentModeLabel = t(`composer:purge.modes.${uiState.mode}`)
  const currentCopy = personaCopy(uiState.persona, lang)
  const displayName = currentCopy.name || uiState.personaName

  const toggleTitle = active
    ? t(midSession ? 'composer:purge.activeMidHint' : 'composer:purge.activeDraftHint', {
        name: displayName,
        mode: currentModeLabel,
      })
    : t(midSession ? 'composer:purge.inactiveMidHint' : 'composer:purge.inactiveDraftHint', {
        name: displayName,
      })

  const commitPurgeChange = (next: {
    enabled: boolean
    personaId: string
    mode: AgentPurgeMode
    strategy: PurgeStrategyOptions
  }) => {
    setDraftPurgePersona(next.personaId)
    setDraftPurgeMode(next.mode)
    setDraftPurgeStrategy(next.strategy)
    if (historySessionFile) {
      void updateSessionPurge(historySessionFile, {
        enabled: next.enabled,
        personaId: next.personaId,
        mode: next.mode,
        strategy: next.strategy,
      })
    } else {
      setDraftPurgeEnabled(next.enabled)
    }
    setPendingConfirm(null)
  }

  const requestPurgeChange = (
    patch: {
      enabled?: boolean
      personaId?: string
      mode?: AgentPurgeMode
      strategy?: Partial<PurgeStrategyOptions>
    },
    opts?: { openPopoverOnConfirm?: boolean },
  ) => {
    const nextEnabled = patch.enabled ?? active
    const nextPersonaId = patch.personaId ?? uiState.persona.id
    const nextMode = patch.mode ?? uiState.mode
    const nextHistoryMode = patch.strategy?.historyMode ?? strategy.historyMode
    const nextThinkingRaw = patch.strategy?.thinkingGuidance ?? strategy.thinkingGuidance
    const nextThinking: PurgeThinkingGuidance =
      nextHistoryMode === 'tunnel' && nextThinkingRaw !== 'suppress' ? 'tool_cot' : nextThinkingRaw
    const nextStrategy: PurgeStrategyOptions = patch.strategy
      ? {
          ...strategy,
          ...patch.strategy,
          thinkingGuidance: nextThinking,
          toolOutputRelay:
            nextHistoryMode === 'tunnel' || nextThinking === 'tool_cot'
              ? true
              : (patch.strategy.toolOutputRelay ?? strategy.toolOutputRelay),
        }
      : strategy

    const nextPersonaObj = config.personas.find((p) => p.id === nextPersonaId) ?? uiState.persona
    const prevHasPrimer = Boolean(currentCopy.primerTurns?.length)
    const nextHasPrimer = Boolean(personaCopy(nextPersonaObj, lang).primerTurns?.length)

    const impact = assessMidSessionPurgeCacheImpact({
      hasPriorTurns: midSession,
      prevEnabled: active,
      nextEnabled,
      prevPersonaId: uiState.persona.id,
      nextPersonaId,
      prevHasPrimer,
      nextHasPrimer,
      prevMode: uiState.mode,
      nextMode,
      prevStrategy: strategy,
      nextStrategy,
    })

    if (impact.kind === 'breaks_prefix') {
      setTailInfoBanner(false)
      setPendingConfirm({
        enabled: nextEnabled,
        personaId: nextPersonaId,
        mode: nextMode,
        strategy: nextStrategy,
        reasons: impact.reasons,
      })
      if (opts?.openPopoverOnConfirm) {
        setMenuOpen(true)
      }
      return
    }

    setTailInfoBanner(impact.kind === 'tail_1_turn')
    commitPurgeChange({
      enabled: nextEnabled,
      personaId: nextPersonaId,
      mode: nextMode,
      strategy: nextStrategy,
    })
  }

  const handleEnableSwitchToggle = () => {
    requestPurgeChange({ enabled: !active }, { openPopoverOnConfirm: true })
  }

  const handleSelectPersona = (personaId: string) => {
    requestPurgeChange({ enabled: true, personaId })
  }

  const handleSelectMode = (mode: AgentPurgeMode) => {
    if (!active && !midSession) {
      setDraftPurgeMode(mode)
      return
    }
    requestPurgeChange({ enabled: active || !midSession, mode })
  }

  const handleSelectPreset = (preset: 'standard' | 'relay_push' | 'tunnel') => {
    const nextStrat = strategyForPreset(preset, strategy)
    if (!active && !midSession) {
      setDraftPurgeStrategy(nextStrat)
      return
    }
    requestPurgeChange({ enabled: true, strategy: nextStrat })
  }

  const handleStrategyPatch = (patch: Partial<PurgeStrategyOptions>) => {
    if (!active && !midSession) {
      setDraftPurgeStrategy(patch)
      return
    }
    requestPurgeChange({ enabled: true, strategy: patch })
  }

  const primaryImpactReason = pendingConfirm?.reasons[0] ?? 'switch_persona'

  return (
    <div data-composer-purge-anchor className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        data-testid="composer-purge-toggle"
        data-purge-state={
          active ? (midSession ? 'active-mid' : 'draft-on') : midSession ? 'off-mid' : 'draft-off'
        }
        title={toggleTitle}
        aria-label={t('composer:purge.choosePersona')}
        onClick={() => {
          setMenuOpen((v) => !v)
          setPendingConfirm(null)
        }}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-colors',
          active
            ? 'border border-primary/35 bg-primary/12 text-primary'
            : 'text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground',
        )}
      >
        <Bot className="h-[15px] w-[15px] shrink-0" strokeWidth={1.85} />
        <span className="max-w-[84px] truncate">
          {active ? shortPersonaLabel(displayName) : t('composer:purge.shortLabel')}
        </span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 opacity-70 transition-transform', menuOpen && 'rotate-180')}
        />
      </button>

      {menuOpen && (
        <ComposerPopover
          anchorSelector="[data-composer-purge-anchor]"
          onClose={() => {
            setMenuOpen(false)
            setPendingConfirm(null)
          }}
          label={t('composer:purge.menuTitle')}
          width={364}
        >
          <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[11.5px] font-medium text-foreground">
                {t('composer:purge.menuTitle')}
              </span>
              {!midSession ? (
                <span className="shrink-0 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  {t('composer:purge.firstTurnFreeBadge')}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={active}
                data-testid="composer-purge-enable-switch"
                onClick={handleEnableSwitchToggle}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium transition-colors',
                  active
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border/70 bg-muted/60 text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    active ? 'bg-primary' : 'bg-muted-foreground/50',
                  )}
                />
                <span>{active ? t('composer:purge.switchOn') : t('composer:purge.switchOff')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  openSettingsToPage('purge')
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <Settings className="h-3 w-3" />
                <span>{t('composer:purge.openSettings')}</span>
              </button>
            </div>
          </div>

          {pendingConfirm && (
            <div
              data-testid="purge-mid-session-confirm"
              className="mx-2 mb-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 p-2 text-[11px] leading-[1.45]"
            >
              <div className="flex items-start gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t('composer:purge.midConfirmTitle')}</span>
              </div>
              <p className="mt-1 text-foreground/85">
                {t(`composer:purge.impactReasons.${primaryImpactReason}`)}
              </p>
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                >
                  {t('composer:purge.midConfirmCancel')}
                </button>
                <button
                  type="button"
                  data-testid="purge-mid-session-apply"
                  onClick={() => commitPurgeChange(pendingConfirm)}
                  className="h-6 rounded bg-amber-600 px-2.5 text-[11px] font-medium text-white hover:bg-amber-500"
                >
                  {t('composer:purge.midConfirmApply')}
                </button>
              </div>
            </div>
          )}

          <div className="max-h-40 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
            {config.personas.map((p) => {
              const selected = p.id === uiState.persona.id
              const copy = personaCopy(p, lang)
              const hasPrimer = Boolean(copy.primerTurns?.length)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPersona(p.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                    selected && active && 'bg-primary/10',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-foreground">
                        {copy.name}
                      </span>
                      {hasPrimer ? (
                        <span className="shrink-0 rounded bg-border/50 px-1 py-0.2 text-[9.5px] text-muted-foreground">
                          {t('composer:purge.primerBadge')}
                        </span>
                      ) : null}
                    </div>
                    {copy.description ? (
                      <div className="line-clamp-1 text-[10.5px] text-muted-foreground/75">
                        {copy.description}
                      </div>
                    ) : null}
                  </div>
                  {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </button>
              )
            })}
          </div>

          <div className="space-y-2 border-t border-border/50 px-3 py-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                <span>{t('composer:purge.modeLabel')}</span>
                <span className="text-[9.5px] text-muted-foreground/65">
                  {t('composer:purge.badges.midSwitchBreaksCache')}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label={t('composer:purge.modeLabel')}
                className="flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
              >
                {AGENT_PURGE_MODES.map((m: AgentPurgeMode) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={uiState.mode === m}
                    onClick={() => handleSelectMode(m)}
                    className={cn(
                      'flex-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground',
                      uiState.mode === m &&
                        'bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                    )}
                  >
                    {t(`composer:purge.modes.${m}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                <span>{t('composer:purge.strategyPresetLabel')}</span>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-[10px] text-primary/85 hover:underline"
                >
                  {showAdvanced
                    ? t('composer:purge.hideAdvanced')
                    : t('composer:purge.showAdvanced')}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'standard', badge: null },
                    { id: 'relay_push', badge: 'tailNoCache' },
                    { id: 'tunnel', badge: 'midBreak' },
                  ] as const
                ).map((item) => {
                  const selected = activePreset === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={t(`composer:purge.presetHints.${item.id}`)}
                      onClick={() => handleSelectPreset(item.id)}
                      className={cn(
                        'flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-colors',
                        selected
                          ? 'border-primary/45 bg-primary/10 text-foreground'
                          : 'border-border/50 text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
                      )}
                    >
                      <span className="text-[11px] font-medium leading-tight">
                        {t(`composer:purge.presets.${item.id}`)}
                      </span>
                      <span className="mt-0.5 text-[9.5px] leading-tight opacity-75">
                        {item.badge
                          ? t(`composer:purge.badges.${item.badge}`)
                          : t('composer:purge.badges.cacheSafe')}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-[10px] leading-[1.4] text-muted-foreground/85">
                {t(`composer:purge.presetHints.${activePreset}`)}
              </p>
              {strategy.historyMode === 'tunnel' && tunnelDowngradedApi ? (
                <div
                  data-testid="purge-tunnel-fallback-notice"
                  className="mt-1 rounded border border-border/60 bg-[var(--bg-hover)]/65 px-2 py-1 text-[10px] leading-[1.4] text-foreground-secondary"
                >
                  {t('composer:purge.tunnelApiDowngradeNotice', { api: tunnelDowngradedApi })}
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                <span>{t('composer:purge.thinkingLabel')}</span>
                <span className="text-[9.5px] text-muted-foreground/65">
                  {strategy.thinkingGuidance === 'tool_cot'
                    ? t('composer:purge.badges.midBreak')
                    : t('composer:purge.badges.cacheSafe')}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label={t('composer:purge.thinkingLabel')}
                className="grid grid-cols-4 gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
              >
                {PURGE_THINKING_GUIDANCES.map((g: PurgeThinkingGuidance) => {
                  const lockedByTunnel =
                    strategy.historyMode === 'tunnel' && g !== 'tool_cot' && g !== 'suppress'
                  const selected = strategy.thinkingGuidance === g
                  return (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={lockedByTunnel}
                      data-testid={`purge-thinking-${g}`}
                      onClick={() => handleStrategyPatch({ thinkingGuidance: g })}
                      className={cn(
                        'rounded-[5px] px-1 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
                        selected &&
                          'bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                      )}
                    >
                      {t(`composer:purge.thinkingModes.${g}`)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-[10px] leading-[1.4] text-muted-foreground/80">
                {t(`composer:purge.thinkingHints.${strategy.thinkingGuidance}`)}
              </p>
            </div>

            {showAdvanced && (
              <div className="space-y-2 rounded-md border border-border/50 bg-[var(--bg-hover)]/45 p-2 text-[11px]">
                <label className="flex cursor-pointer items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-foreground/90">
                      <span>{t('composer:purge.opts.primer')}</span>
                      <span className="rounded bg-border/55 px-1 text-[9.5px] text-muted-foreground">
                        {t('composer:purge.badges.midBreak')}
                      </span>
                    </span>
                    <span className="block text-[10px] leading-[1.35] text-muted-foreground/80">
                      {t('composer:purge.optHints.primer')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={strategy.primerEnabled}
                    onChange={(e) => handleStrategyPatch({ primerEnabled: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--brand)]"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground/90">{t('composer:purge.opts.scrub')}</span>
                    <span className="block text-[10px] leading-[1.35] text-muted-foreground/80">
                      {t('composer:purge.optHints.scrub')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={strategy.scrubHistory}
                    onChange={(e) => handleStrategyPatch({ scrubHistory: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--brand)]"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-foreground/90">
                      <span>{t('composer:purge.opts.toolRelay')}</span>
                      <span className="rounded bg-border/55 px-1 text-[9.5px] text-muted-foreground">
                        {t('composer:purge.badges.midBreak')}
                      </span>
                    </span>
                    <span className="block text-[10px] leading-[1.35] text-muted-foreground/80">
                      {t('composer:purge.optHints.toolRelay')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={
                      strategy.historyMode === 'tunnel' || strategy.thinkingGuidance === 'tool_cot'
                    }
                    checked={
                      strategy.toolOutputRelay ||
                      strategy.historyMode === 'tunnel' ||
                      strategy.thinkingGuidance === 'tool_cot'
                    }
                    onChange={(e) => handleStrategyPatch({ toolOutputRelay: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--brand)] disabled:opacity-50"
                  />
                </label>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground/90">{t('composer:purge.opts.historyMode')}</span>
                    <select
                      value={strategy.historyMode}
                      onChange={(e) =>
                        handleStrategyPatch({ historyMode: e.target.value as PurgeHistoryMode })
                      }
                      className="h-6 rounded border border-border/60 bg-background px-1.5 text-[10.5px] text-foreground"
                    >
                      <option value="none">{t('composer:purge.historyModes.none')}</option>
                      <option value="push">{t('composer:purge.historyModes.push')}</option>
                      <option value="tunnel">{t('composer:purge.historyModes.tunnel')}</option>
                    </select>
                  </div>
                  <p className="text-[10px] leading-[1.35] text-muted-foreground/80">
                    {t('composer:purge.optHints.historyMode')}
                  </p>
                </div>

                <label className="flex cursor-pointer items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground/90">{t('composer:purge.opts.autoRetry')}</span>
                    <span className="block text-[10px] leading-[1.35] text-muted-foreground/80">
                      {t('composer:purge.optHints.autoRetry')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={strategy.autoRetry}
                    onChange={(e) => handleStrategyPatch({ autoRetry: e.target.checked })}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--brand)]"
                  />
                </label>

                <div className="border-t border-border/45 pt-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1 text-foreground/90">
                      <span>{t('composer:purge.opts.cipher')}</span>
                      <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[9.5px] font-medium text-amber-700 dark:text-amber-300">
                        {t('composer:purge.badges.notRecommendedDrift')}
                      </span>
                    </span>
                    <div className="flex gap-0.5 rounded bg-background p-0.5">
                      {PURGE_CIPHER_LEVELS.map((lv: PurgeCipherLevel) => (
                        <button
                          key={lv}
                          type="button"
                          onClick={() => handleStrategyPatch({ cipherLevel: lv })}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                            strategy.cipherLevel === lv
                              ? lv === 'off'
                                ? 'bg-[var(--bg-active)] font-medium text-foreground'
                                : 'bg-amber-500/20 font-medium text-amber-700 dark:text-amber-300'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {t(`composer:purge.cipherLevels.${lv}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {strategy.cipherLevel !== 'off' && (
              <div
                data-testid="purge-cipher-drift-warning"
                className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300"
              >
                {t(
                  strategy.cipherLevel === 'full'
                    ? 'composer:purge.cipherFullDriftAndCacheWarn'
                    : 'composer:purge.cipherDriftWarn',
                )}
              </div>
            )}

            {tailInfoBanner && midSession && !pendingConfirm && (
              <div className="rounded-md border border-border/60 bg-[var(--bg-hover)] px-2 py-1 text-[10.5px] leading-4 text-muted-foreground">
                {t('composer:purge.tailPushMidNotice')}
              </div>
            )}

            <div
              className={cn(
                'text-[10.5px] leading-4',
                midSession
                  ? 'text-amber-600/85 dark:text-amber-400/85'
                  : 'text-muted-foreground/65',
              )}
            >
              {t(midSession ? 'composer:purge.cacheBreakWarn' : 'composer:purge.firstTurnNote')}
            </div>
          </div>
        </ComposerPopover>
      )}
    </div>
  )
}
