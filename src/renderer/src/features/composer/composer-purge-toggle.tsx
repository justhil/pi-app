import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AGENT_PURGE_MODES,
  assessMidSessionPurgeCacheImpact,
  detectPurgeStrategyPreset,
  PURGE_CIPHER_LEVELS,
  personaCopy,
  personaLanguage,
  strategyForPreset,
  type AgentPurgeMode,
  type PurgeCipherLevel,
  type PurgeHistoryMode,
  type PurgeMidSessionImpactReason,
  type PurgeStrategyOptions,
} from '@shared/agent-purge'
import { AlertTriangle, Bot, Check, ChevronDown, Settings } from '@renderer/components/icons'
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
    const nextStrategy: PurgeStrategyOptions = patch.strategy
      ? {
          ...strategy,
          ...patch.strategy,
          toolOutputRelay:
            (patch.strategy.historyMode ?? strategy.historyMode) === 'tunnel'
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

  const handleToolbarToggleClick = () => {
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
      <div
        className={cn(
          'flex h-7 items-center rounded-md transition-colors',
          active
            ? 'border border-primary/35 bg-primary/12 text-primary'
            : 'text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground',
        )}
      >
        <button
          type="button"
          aria-pressed={active}
          data-testid="composer-purge-toggle"
          data-purge-state={
            active ? (midSession ? 'active-mid' : 'draft-on') : midSession ? 'off-mid' : 'draft-off'
          }
          title={toggleTitle}
          aria-label={toggleTitle}
          onClick={handleToolbarToggleClick}
          className="flex h-full items-center gap-1 rounded-l-md pl-1.5 pr-1 text-[12px] font-medium"
        >
          <Bot className="h-[15px] w-[15px] shrink-0" strokeWidth={1.85} />
          <span className="max-w-[84px] truncate">
            {active ? shortPersonaLabel(displayName) : t('composer:purge.shortLabel')}
          </span>
        </button>
        <button
          type="button"
          aria-label={t('composer:purge.choosePersona')}
          title={t('composer:purge.choosePersona')}
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((v) => !v)
            setPendingConfirm(null)
          }}
          className="flex h-full w-4 items-center justify-center rounded-r-md pr-0.5 opacity-70 hover:opacity-100"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {menuOpen && (
        <ComposerPopover
          anchorSelector="[data-composer-purge-anchor]"
          onClose={() => {
            setMenuOpen(false)
            setPendingConfirm(null)
          }}
          label={t('composer:purge.menuTitle')}
          width={332}
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-foreground-secondary">
                {t('composer:purge.menuTitle')}
              </span>
              {!midSession ? (
                <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  {t('composer:purge.firstTurnFreeBadge')}
                </span>
              ) : null}
            </div>
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
                      onClick={() => handleSelectPreset(item.id)}
                      className={cn(
                        'flex flex-col items-start rounded-md border px-2 py-1 text-left transition-colors',
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
            </div>

            {showAdvanced && (
              <div className="space-y-1.5 rounded-md border border-border/50 bg-[var(--bg-hover)]/45 p-2 text-[11px]">
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-foreground/90">
                    <span>{t('composer:purge.opts.primer')}</span>
                    <span className="rounded bg-border/55 px-1 text-[9.5px] text-muted-foreground">
                      {t('composer:purge.badges.midBreak')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={strategy.primerEnabled}
                    onChange={(e) => handleStrategyPatch({ primerEnabled: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--brand)]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="text-foreground/90">{t('composer:purge.opts.scrub')}</span>
                  <input
                    type="checkbox"
                    checked={strategy.scrubHistory}
                    onChange={(e) => handleStrategyPatch({ scrubHistory: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--brand)]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-foreground/90">
                    <span>{t('composer:purge.opts.toolRelay')}</span>
                    <span className="rounded bg-border/55 px-1 text-[9.5px] text-muted-foreground">
                      {t('composer:purge.badges.midBreak')}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={strategy.historyMode === 'tunnel'}
                    checked={strategy.toolOutputRelay || strategy.historyMode === 'tunnel'}
                    onChange={(e) => handleStrategyPatch({ toolOutputRelay: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--brand)] disabled:opacity-50"
                  />
                </label>

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

                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="text-foreground/90">{t('composer:purge.opts.autoRetry')}</span>
                  <input
                    type="checkbox"
                    checked={strategy.autoRetry}
                    onChange={(e) => handleStrategyPatch({ autoRetry: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--brand)]"
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
