import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AGENT_PURGE_MODES, personaCopy, personaLanguage, type AgentPurgeMode } from '@shared/agent-purge'
import { Bot, Check, ChevronDown, Settings } from '@renderer/components/icons'
import {
  loadAgentPurgeState,
  openSettingsToPage,
  resolveComposerPurgeState,
  setDraftPurgeEnabled,
  setDraftPurgeMode,
  setDraftPurgePersona,
  syncPurgeDraftContextKey,
  updateSessionPurge,
  useAgentPurgeStore,
} from '@renderer/lib/agent-purge-store'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerPopover } from './composer-popover'

function shortPersonaLabel(name: string): string {
  const first = name.split(/[·—\-|]/)[0]?.trim() || name.trim()
  return first.length > 8 ? `${first.slice(0, 8)}…` : first
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

  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const timelineLength = useUIStore((s) => s.timelineItems.length)
  const optimisticPendingUserText = useUIStore((s) => s.optimisticPendingUserText)

  const config = useAgentPurgeStore((s) => s.config)
  const purgedSessions = useAgentPurgeStore((s) => s.purgedSessions)
  const draftEnabled = useAgentPurgeStore((s) => s.draftEnabled)
  const draftPersonaId = useAgentPurgeStore((s) => s.draftPersonaId)
  const draftMode = useAgentPurgeStore((s) => s.draftMode)
  const pendingLock = useAgentPurgeStore((s) => s.pendingLock)

  useEffect(() => {
    void loadAgentPurgeState()
  }, [])

  // Refresh locked session map when switching to an unknown session file (covers newly forked/cloned sessions).
  useEffect(() => {
    if (!historySessionFile) return
    const st = useAgentPurgeStore.getState()
    if (!st.loaded) void loadAgentPurgeState()
  }, [historySessionFile])

  useEffect(() => {
    syncPurgeDraftContextKey(draftContextKey)
    setMenuOpen(false)
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
    pendingLock,
  })

  const active = uiState.checked
  const midSession = uiState.midSession
  const currentModeLabel = t(`composer:purge.modes.${uiState.mode}`)
  const displayName = personaCopy(uiState.persona, lang).name || uiState.personaName
  const toggleTitle = active
    ? t(midSession ? 'composer:purge.activeMidHint' : 'composer:purge.activeDraftHint', {
        name: displayName,
        mode: currentModeLabel,
      })
    : t(midSession ? 'composer:purge.inactiveMidHint' : 'composer:purge.inactiveDraftHint', {
        name: displayName,
      })

  const handleToggle = () => {
    if (historySessionFile) {
      void updateSessionPurge(historySessionFile, {
        enabled: !active,
        personaId: uiState.persona.id,
        mode: uiState.mode,
      })
    } else {
      setDraftPurgeEnabled(!active)
    }
  }

  const handleSelectPersona = (personaId: string) => {
    setDraftPurgePersona(personaId)
    if (historySessionFile) {
      void updateSessionPurge(historySessionFile, {
        enabled: true,
        personaId,
        mode: uiState.mode,
      })
    } else {
      setDraftPurgeEnabled(true)
    }
    setMenuOpen(false)
  }

  const handleSelectMode = (mode: AgentPurgeMode) => {
    setDraftPurgeMode(mode)
    if (historySessionFile && active) {
      void updateSessionPurge(historySessionFile, {
        enabled: true,
        personaId: uiState.persona.id,
        mode,
      })
    }
  }

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
          data-purge-state={active ? (midSession ? 'active-mid' : 'draft-on') : midSession ? 'off-mid' : 'draft-off'}
          title={toggleTitle}
          aria-label={toggleTitle}
          onClick={handleToggle}
          className="flex h-full items-center gap-1 rounded-l-md pl-1.5 pr-1 text-[12px] font-medium"
        >
          <Bot className="h-[15px] w-[15px] shrink-0" strokeWidth={1.85} />
          <span className="max-w-[76px] truncate">
            {active ? shortPersonaLabel(displayName) : t('composer:purge.shortLabel')}
          </span>
        </button>
        <button
          type="button"
          aria-label={t('composer:purge.choosePersona')}
          title={t('composer:purge.choosePersona')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-full w-4 items-center justify-center rounded-r-md pr-0.5 opacity-70 hover:opacity-100"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {menuOpen && (
        <ComposerPopover
          anchorSelector="[data-composer-purge-anchor]"
          onClose={() => setMenuOpen(false)}
          label={t('composer:purge.menuTitle')}
          width={284}
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <span className="text-[11px] font-medium text-foreground-secondary">
              {t('composer:purge.menuTitle')}
            </span>
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

          <div className="max-h-44 space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
            {config.personas.map((p) => {
              const selected = p.id === uiState.persona.id
              const copy = personaCopy(p, lang)
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
                    <div className="truncate text-[12px] font-medium text-foreground">{copy.name}</div>
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

          <div className="border-t border-border/50 px-3 py-2">
            <div className="mb-1 text-[10.5px] text-muted-foreground/75">
              {t('composer:purge.modeLabel')}
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
            <div
              className={cn(
                'mt-1.5 text-[10.5px] leading-4',
                midSession ? 'text-amber-600/85 dark:text-amber-400/85' : 'text-muted-foreground/65',
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
