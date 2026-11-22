import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AGENT_PURGE_MODES,
  assessMidSessionPurgeCacheImpact,
  detectPurgeStrategyPreset,
  PURGE_CIPHER_LEVELS,
  PURGE_HISTORY_MODES,
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
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Settings,
} from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
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

const PRESET_TABS = [
  { id: 'standard', titleKey: 'composer:purge.presetShort.standard', subKey: 'composer:purge.presetSub.standard' },
  { id: 'relay_push', titleKey: 'composer:purge.presetShort.relay_push', subKey: 'composer:purge.presetSub.relay_push' },
  { id: 'tunnel', titleKey: 'composer:purge.presetShort.tunnel', subKey: 'composer:purge.presetSub.tunnel' },
] as const

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
  const currentThinkingLabel = t(`composer:purge.thinkingModes.${strategy.thinkingGuidance}`)
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

  const handleTriggerClick = () => {
    setMenuOpen((prev) => {
      const next = !prev
      if (next) {
        const ui = useUIStore.getState()
        ui.setModelPickerOpen(false)
        ui.setThinkingPickerOpen(false)
      }
      return next
    })
    setPendingConfirm(null)
  }

  const handleEnableSwitchToggle = (checked: boolean) => {
    requestPurgeChange({ enabled: checked }, { openPopoverOnConfirm: true })
  }

  const handleSelectPersona = (personaId: string) => {
    requestPurgeChange({ enabled: true, personaId })
  }

  const handleSelectMode = (mode: AgentPurgeMode) => {
    requestPurgeChange({ enabled: true, mode })
  }

  const handleSelectPreset = (preset: 'standard' | 'relay_push' | 'tunnel') => {
    const nextStrat = strategyForPreset(preset, strategy)
    requestPurgeChange({ enabled: true, strategy: nextStrat })
  }

  const handleStrategyPatch = (patch: Partial<PurgeStrategyOptions>) => {
    requestPurgeChange({ enabled: true, strategy: patch })
  }

  const primaryImpactReason = pendingConfirm?.reasons[0] ?? 'switch_persona'
  const relayLocked = strategy.historyMode === 'tunnel' || strategy.thinkingGuidance === 'tool_cot'

  return (
    <div
      data-composer-purge-anchor
      data-pi-slot="composer-purge-wrap"
      data-active={active ? 'true' : 'false'}
      className="relative flex shrink-0 items-center"
    >
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        data-pi-slot="composer-purge-btn"
        data-testid="composer-purge-toggle"
        data-purge-state={
          active ? (midSession ? 'active-mid' : 'draft-on') : midSession ? 'off-mid' : 'draft-off'
        }
        title={toggleTitle}
        aria-label={t('composer:purge.choosePersona')}
        onClick={handleTriggerClick}
        className={cn(
          'composer-toolbar-btn flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-colors',
          menuOpen && !active && 'bg-[var(--bg-active)] text-foreground',
          active
            ? 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-foreground-secondary/75 hover:bg-[var(--bg-hover)] hover:text-foreground',
        )}
      >
        <Bot className="h-[14px] w-[14px] shrink-0" strokeWidth={1.85} />
        <span data-pi-slot="composer-purge-label" className="inline-flex items-center gap-1">
          <span className="max-w-[84px] truncate">
            {active ? shortPersonaLabel(displayName) : t('composer:purge.shortLabel')}
          </span>
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', menuOpen && 'rotate-180')}
          />
        </span>
      </button>

      {menuOpen && (
        <ComposerPopover
          anchorSelector="[data-composer-purge-anchor]"
          align="start"
          onClose={() => {
            setMenuOpen(false)
            setPendingConfirm(null)
          }}
          label={t('composer:purge.menuTitle')}
          width={336}
        >
          {/* Fixed Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                  active ? 'bg-primary' : 'bg-muted-foreground/35',
                )}
              />
              <span className="truncate text-[12px] font-medium text-foreground">
                {t('composer:purge.menuTitle')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                title={t('composer:purge.openSettings')}
                aria-label={t('composer:purge.openSettings')}
                onClick={() => {
                  setMenuOpen(false)
                  openSettingsToPage('purge')
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <Switch
                checked={active}
                data-testid="composer-purge-enable-switch"
                aria-label={active ? t('composer:purge.switchOn') : t('composer:purge.switchOff')}
                onCheckedChange={handleEnableSwitchToggle}
                className="origin-right scale-[0.8]"
              />
            </div>
          </div>

          {/* Single Unified Scroll Body — never clips expanded options */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {pendingConfirm && (
              <div
                data-testid="purge-mid-session-confirm"
                className="mx-2.5 mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-[11px] leading-[1.45]"
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
                    className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
                  >
                    {t('composer:purge.midConfirmCancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="purge-mid-session-apply"
                    onClick={() => commitPurgeChange(pendingConfirm)}
                    className="h-6 rounded-md bg-amber-600 px-2.5 text-[11px] font-medium text-white hover:bg-amber-500"
                  >
                    {t('composer:purge.midConfirmApply')}
                  </button>
                </div>
              </div>
            )}

            {/* Section 1: Persona Templates */}
            <div className="px-2 py-2">
              <div className="px-1.5 pb-1 text-[10.5px] text-muted-foreground/70">
                {t('composer:purge.personaSectionLabel')}
              </div>
              <div className="space-y-0.5">
                {config.personas.map((p) => {
                  const selected = p.id === uiState.persona.id
                  const copy = personaCopy(p, lang)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPersona(p.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
                        selected && active && 'bg-primary/10',
                        selected && !active && 'bg-[var(--bg-hover)]/55',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-[12px] leading-tight',
                            selected && active
                              ? 'font-medium text-foreground'
                              : 'font-normal text-foreground/90',
                          )}
                        >
                          {copy.name}
                        </div>
                        {copy.description ? (
                          <div className="mt-0.5 line-clamp-1 text-[10.5px] leading-4 text-muted-foreground/70">
                            {copy.description}
                          </div>
                        ) : null}
                      </div>
                      {selected ? (
                        <Check
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            active ? 'text-primary' : 'text-muted-foreground/55',
                          )}
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Section 2: Intensity Preset + Section 3: Collapsible Advanced */}
            <div className={cn('transition-opacity', !active && 'opacity-70 hover:opacity-100')}>
              <div className="border-t border-border/45 px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground/75">
                  <span>{t('composer:purge.strategyPresetLabel')}</span>
                  {activePreset === 'custom' ? (
                    <span className="text-[10px] font-medium text-primary/85">
                      {t('composer:purge.presets.custom')}
                    </span>
                  ) : null}
                </div>

                <div
                  role="radiogroup"
                  aria-label={t('composer:purge.strategyPresetLabel')}
                  className="grid grid-cols-3 gap-0.5 rounded-lg bg-[var(--bg-hover)] p-0.5"
                >
                  {PRESET_TABS.map((item) => {
                    const selected = activePreset === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-testid={`purge-preset-${item.id}`}
                        title={t(`composer:purge.presetHints.${item.id}`)}
                        onClick={() => handleSelectPreset(item.id)}
                        className={cn(
                          'flex flex-col items-center rounded-[6px] px-1.5 py-1.5 text-center transition-colors',
                          selected
                            ? 'bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="text-[11.5px] font-medium leading-none">
                          {t(item.titleKey)}
                        </span>
                        <span className="mt-1 text-[9.5px] leading-none opacity-70">
                          {t(item.subKey)}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="mt-1.5 text-[10.5px] leading-[1.45] text-muted-foreground/80">
                  {t(`composer:purge.presetHints.${activePreset}`)}
                </p>

                {strategy.historyMode === 'tunnel' && tunnelDowngradedApi ? (
                  <div
                    data-testid="purge-tunnel-fallback-notice"
                    className="mt-1.5 rounded-md border border-border/60 bg-[var(--bg-hover)]/65 px-2 py-1 text-[10.5px] leading-[1.4] text-foreground-secondary"
                  >
                    {t('composer:purge.tunnelApiDowngradeNotice', { api: tunnelDowngradedApi })}
                  </div>
                ) : null}

                {tailInfoBanner && midSession && !pendingConfirm ? (
                  <div className="mt-1.5 rounded-md border border-border/55 bg-[var(--bg-hover)]/55 px-2 py-1 text-[10.5px] leading-[1.4] text-muted-foreground">
                    {t('composer:purge.tailPushMidNotice')}
                  </div>
                ) : null}

                {strategy.cipherLevel !== 'off' && !showAdvanced ? (
                  <div
                    data-testid="purge-cipher-drift-warning"
                    className="mt-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300"
                  >
                    {t(
                      strategy.cipherLevel === 'full'
                        ? 'composer:purge.cipherFullDriftAndCacheWarn'
                        : 'composer:purge.cipherDriftWarn',
                    )}
                  </div>
                ) : null}
              </div>

              {/* Section 3: Collapsible Advanced Fine-tuning with Live Summary */}
              <div className="border-t border-border/45">
                <button
                  type="button"
                  aria-expanded={showAdvanced}
                  data-testid="purge-advanced-toggle"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] transition-colors hover:bg-[var(--bg-hover)]/55"
                >
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                      showAdvanced && 'rotate-90',
                    )}
                  />
                  <span className="font-medium text-foreground-secondary">
                    {t('composer:purge.advancedTitle')}
                  </span>
                  <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-[10.5px] text-muted-foreground/75">
                    <span className="truncate">
                      {currentModeLabel} · {currentThinkingLabel}
                    </span>
                    {strategy.cipherLevel !== 'off' ? (
                      <span className="shrink-0 text-amber-600 dark:text-amber-400">
                        · {t('composer:purge.opts.cipher')}
                      </span>
                    ) : null}
                  </span>
                </button>

                {showAdvanced && (
                  <div className="space-y-3 border-t border-border/35 bg-[var(--bg-hover)]/25 px-3 py-2.5">
                    {/* Chain-of-thought steering */}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                        <span>{t('composer:purge.thinkingLabel')}</span>
                        <span className="text-[10px] text-muted-foreground/60">
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
                                'rounded-[5px] px-1 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
                                selected &&
                                  'bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                              )}
                            >
                              {t(`composer:purge.thinkingModes.${g}`)}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-1 text-[10px] leading-[1.4] text-muted-foreground/75">
                        {t(`composer:purge.thinkingHints.${strategy.thinkingGuidance}`)}
                      </p>
                    </div>

                    {/* System injection mode */}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                        <span>{t('composer:purge.modeLabel')}</span>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={t('composer:purge.modeLabel')}
                        className="grid grid-cols-3 gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
                      >
                        {AGENT_PURGE_MODES.map((m: AgentPurgeMode) => (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={uiState.mode === m}
                            onClick={() => handleSelectMode(m)}
                            className={cn(
                              'rounded-[5px] px-1.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground',
                              uiState.mode === m &&
                                'bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                            )}
                          >
                            {t(`composer:purge.modes.${m}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* History wrapping mode (replaces native <select>) */}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted-foreground/80">
                        <span>{t('composer:purge.opts.historyMode')}</span>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={t('composer:purge.opts.historyMode')}
                        className="grid grid-cols-3 gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
                      >
                        {PURGE_HISTORY_MODES.map((hm: PurgeHistoryMode) => (
                          <button
                            key={hm}
                            type="button"
                            role="radio"
                            aria-checked={strategy.historyMode === hm}
                            onClick={() => handleStrategyPatch({ historyMode: hm })}
                            className={cn(
                              'rounded-[5px] px-1 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground',
                              strategy.historyMode === hm &&
                                'bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]',
                            )}
                          >
                            {t(`composer:purge.historyShort.${hm}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Boolean toggles — unified Switch rows */}
                    <div className="space-y-2 border-t border-border/40 pt-2">
                      {(
                        [
                          {
                            key: 'primerEnabled',
                            label: t('composer:purge.opts.primer'),
                            hint: t('composer:purge.optHints.primer'),
                            checked: strategy.primerEnabled,
                            disabled: false,
                            onChange: (v: boolean) => handleStrategyPatch({ primerEnabled: v }),
                          },
                          {
                            key: 'scrubHistory',
                            label: t('composer:purge.opts.scrub'),
                            hint: t('composer:purge.optHints.scrub'),
                            checked: strategy.scrubHistory,
                            disabled: false,
                            onChange: (v: boolean) => handleStrategyPatch({ scrubHistory: v }),
                          },
                          {
                            key: 'toolOutputRelay',
                            label: t('composer:purge.opts.toolRelay'),
                            hint: t('composer:purge.optHints.toolRelay'),
                            checked: strategy.toolOutputRelay || relayLocked,
                            disabled: relayLocked,
                            onChange: (v: boolean) => handleStrategyPatch({ toolOutputRelay: v }),
                          },
                          {
                            key: 'autoRetry',
                            label: t('composer:purge.opts.autoRetry'),
                            hint: t('composer:purge.optHints.autoRetry'),
                            checked: strategy.autoRetry,
                            disabled: false,
                            onChange: (v: boolean) => handleStrategyPatch({ autoRetry: v }),
                          },
                        ] as const
                      ).map((row) => (
                        <div
                          key={row.key}
                          title={row.hint}
                          className={cn(
                            'flex items-center justify-between gap-2.5 text-[11.5px]',
                            row.disabled && 'opacity-60',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-foreground/90">{row.label}</div>
                            <div className="line-clamp-1 text-[10px] text-muted-foreground/70">
                              {row.hint}
                            </div>
                          </div>
                          <Switch
                            checked={row.checked}
                            disabled={row.disabled}
                            aria-label={row.label}
                            onCheckedChange={row.onChange}
                            className="origin-right scale-[0.74]"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Keyword substitution (discouraged) */}
                    <div className="border-t border-border/40 pt-2">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="text-foreground/85">{t('composer:purge.opts.cipher')}</span>
                        <span className="text-[10px] text-amber-600/90 dark:text-amber-400/90">
                          {t('composer:purge.badges.notRecommendedDrift')}
                        </span>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={t('composer:purge.opts.cipher')}
                        className="grid grid-cols-3 gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5"
                      >
                        {PURGE_CIPHER_LEVELS.map((lv: PurgeCipherLevel) => (
                          <button
                            key={lv}
                            type="button"
                            role="radio"
                            aria-checked={strategy.cipherLevel === lv}
                            onClick={() => handleStrategyPatch({ cipherLevel: lv })}
                            className={cn(
                              'rounded-[5px] px-1 py-1 text-[10.5px] transition-colors',
                              strategy.cipherLevel === lv
                                ? lv === 'off'
                                  ? 'bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)] dark:bg-[#46474d]'
                                  : 'bg-amber-500/20 font-medium text-amber-700 dark:text-amber-300'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {t(`composer:purge.cipherLevels.${lv}`)}
                          </button>
                        ))}
                      </div>
                      {strategy.cipherLevel !== 'off' ? (
                        <div
                          data-testid="purge-cipher-drift-warning"
                          className="mt-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-[1.4] text-amber-700 dark:text-amber-300"
                        >
                          {t(
                            strategy.cipherLevel === 'full'
                              ? 'composer:purge.cipherFullDriftAndCacheWarn'
                              : 'composer:purge.cipherDriftWarn',
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Fixed Slim Footer */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5 text-[10.5px]">
            <span
              className={cn(
                'truncate',
                midSession
                  ? 'text-amber-600/85 dark:text-amber-400/85'
                  : 'text-muted-foreground/70',
              )}
            >
              {t(midSession ? 'composer:purge.footerMid' : 'composer:purge.footerFirstTurn')}
            </span>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                openSettingsToPage('purge')
              }}
              className="shrink-0 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('composer:purge.openFullSettings')}
            </button>
          </div>
        </ComposerPopover>
      )}
    </div>
  )
}
