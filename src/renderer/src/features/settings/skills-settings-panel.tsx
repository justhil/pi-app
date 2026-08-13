import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Copy,
  Folder,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type AppIconComponent,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { Switch } from '@renderer/components/ui/switch'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import { btnOutline, btnPrimary, inputCls, textareaCls } from '@renderer/features/settings/settings-controls'
import { SKILL_ICON_KEYS, type SkillIconKey } from '@shared/skill-catalog'

type SkillRow = {
  name: string
  description: string
  path?: string
  source?: string
  key: string
  enabled: boolean
  command: string
  effective?: boolean
  shadowed?: boolean
  shadowedBy?: string
  editable?: boolean
  movable?: boolean
  canCopyToUser?: boolean
  canCopyToProject?: boolean
  scope?: string
  origin?: string
  alias?: string
  icon?: string
}

type SkillFilter = 'all' | 'enabled' | 'disabled' | 'project' | 'user' | 'readonly'
type SkillPresentation = Record<string, { alias?: string; icon?: SkillIconKey }>
type Feedback = { key: string; kind: 'success' | 'error'; message: string } | null

const SKILL_ICONS: Record<string, AppIconComponent> = {
  list: Wrench,
  'book-open': BookOpen,
  sparkles: Sparkles,
  terminal: Terminal,
  wrench: Wrench,
  boxes: Boxes,
}

function skillIcon(key?: string): AppIconComponent {
  return (key && SKILL_ICONS[key]) || Wrench
}

function overridesFromRows(rows: SkillRow[]): Record<string, boolean> {
  const overrides: Record<string, boolean> = {}
  for (const row of rows) overrides[row.key] = row.enabled
  return overrides
}

function overridesEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function presentationEqual(a: SkillPresentation, b: SkillPresentation): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key]?.alias || '') !== (b[key]?.alias || '')) return false
    if ((a[key]?.icon || '') !== (b[key]?.icon || '')) return false
  }
  return true
}

function normalizePresentation(raw: unknown): SkillPresentation {
  if (!raw || typeof raw !== 'object') return {}
  const next: SkillPresentation = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const row = value as { alias?: unknown; icon?: unknown }
    const alias = typeof row.alias === 'string' ? row.alias : undefined
    const icon = SKILL_ICON_KEYS.includes(row.icon as SkillIconKey) ? (row.icon as SkillIconKey) : undefined
    if (alias || icon) next[key] = { alias, icon }
  }
  return next
}

function sortConfirmed(rows: SkillRow[]): SkillRow[] {
  return [...rows].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (!!a.effective !== !!b.effective) return a.effective ? -1 : 1
    return (a.alias || a.name).localeCompare(b.alias || b.name)
  })
}

export function SkillsSettingsPanel() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [baseline, setBaseline] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [baselinePresentation, setBaselinePresentation] = useState<SkillPresentation>({})
  const [presentationDraft, setPresentationDraft] = useState<SkillPresentation>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [complete, setComplete] = useState(true)
  const [descDraft, setDescDraft] = useState('')
  const [descError, setDescError] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const loadSeq = useRef(0)

  const skillsRef = useRef(skills)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const presentationDraftRef = useRef(presentationDraft)
  const baselinePresentationRef = useRef(baselinePresentation)
  skillsRef.current = skills
  draftRef.current = draft
  baselineRef.current = baseline
  presentationDraftRef.current = presentationDraft
  baselinePresentationRef.current = baselinePresentation

  const load = useCallback(async (silent = false, preserveDraft = false) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    setLoadError('')
    try {
      const [response, settingsResponse] = await Promise.all([
        ipcClient.invoke('skills.list'),
        ipcClient.invoke('settings.get', { key: 'skillPresentation' }),
      ])
      if (seq !== loadSeq.current) return
      const rows: SkillRow[] = response?.skills || response?.candidates || []
      const confirmed = sortConfirmed(rows)
      const overrides = overridesFromRows(confirmed)
      const presentation = normalizePresentation(settingsResponse?.settings?.skillPresentation)
      const previousBaseline = baselineRef.current
      const previousBaselinePresentation = baselinePresentationRef.current
      setComplete(response?.complete !== false)
      setSkills(confirmed)
      setBaseline(overrides)
      setBaselinePresentation(presentation)

      if (preserveDraft) {
        const previousDraft = draftRef.current
        const nextDraft = Object.fromEntries(
          confirmed.map((skill) => [
            skill.key,
            previousDraft[skill.key] !== previousBaseline[skill.key]
              ? previousDraft[skill.key]
              : overrides[skill.key],
          ]),
        )
        const validKeys = new Set(confirmed.map((skill) => skill.key))
        const previousPresentation = presentationDraftRef.current
        const nextPresentation = { ...presentation }
        for (const [key, value] of Object.entries(previousPresentation)) {
          if (
            validKeys.has(key) &&
            !presentationEqual({ [key]: value }, { [key]: previousBaselinePresentation[key] || {} })
          ) {
            nextPresentation[key] = value
          }
        }
        setDraft(nextDraft)
        setPresentationDraft(nextPresentation)
        draftRef.current = nextDraft
        presentationDraftRef.current = nextPresentation
      } else {
        setDraft({ ...overrides })
        setPresentationDraft(presentation)
        draftRef.current = overrides
        presentationDraftRef.current = presentation
      }
      baselineRef.current = overrides
      baselinePresentationRef.current = presentation
    } catch (error) {
      if (seq === loadSeq.current) setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      if (seq === loadSeq.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const displayRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return skills.filter((skill) => {
      const enabled = draft[skill.key] ?? skill.enabled
      if (filter === 'enabled' && !enabled) return false
      if (filter === 'disabled' && enabled) return false
      if (filter === 'project' && skill.scope !== 'project') return false
      if (filter === 'user' && skill.scope !== 'user') return false
      if (filter === 'readonly' && skill.editable) return false
      if (!normalizedQuery) return true
      const meta = presentationDraft[skill.key]
      return [meta?.alias, skill.alias, skill.name, skill.description, skill.command, skill.path, skill.source].some((part) =>
        String(part || '').toLowerCase().includes(normalizedQuery),
      )
    })
  }, [skills, draft, presentationDraft, query, filter])

  const enabledCount = skills.filter((skill) => draft[skill.key] ?? skill.enabled).length
  const changedCount = skills.filter(
    (skill) => (draft[skill.key] ?? skill.enabled) !== (baseline[skill.key] ?? skill.enabled),
  ).length
  const presentationChanged = !presentationEqual(presentationDraft, baselinePresentation)

  useSettingsDirtySlice({
    id: 'skills',
    label: t('settings:skills.title'),
    isDirty: () =>
      !overridesEqual(draftRef.current, baselineRef.current) ||
      !presentationEqual(presentationDraftRef.current, baselinePresentationRef.current),
    commit: async () => {
      const changes: Array<{ key: string; enabled: boolean }> = []
      for (const skill of skillsRef.current) {
        const wanted = draftRef.current[skill.key] ?? skill.enabled
        const previous = baselineRef.current[skill.key] ?? skill.enabled
        if (wanted !== previous) changes.push({ key: skill.key, enabled: wanted })
      }
      if (changes.length > 0) {
        const response = await ipcClient.invoke('skills.applyOverrides', { changes })
        if (response?.ok === false) throw new Error(String(response.error || t('settings:skills.saveFailed')))
      }
      if (!presentationEqual(presentationDraftRef.current, baselinePresentationRef.current)) {
        const response = await ipcClient.invoke('settings.set', {
          key: 'skillPresentation',
          value: presentationDraftRef.current,
        })
        if (response?.ok === false) {
          throw new Error(String(response.error || t('settings:skills.saveFailed')))
        }
      }
      await load(true)
      notifySettingsDirtyChanged()
    },
    discard: () => {
      const previous = baselineRef.current
      setDraft({ ...previous })
      draftRef.current = { ...previous }
      const previousPresentation = baselinePresentationRef.current
      setPresentationDraft({ ...previousPresentation })
      presentationDraftRef.current = { ...previousPresentation }
      setFeedback(null)
      notifySettingsDirtyChanged()
    },
  })

  const toggle = (row: SkillRow) => {
    if (row.shadowed) return
    const next = !(draft[row.key] ?? row.enabled)
    setDraft((previous) => {
      const updated = { ...previous, [row.key]: next }
      draftRef.current = updated
      return updated
    })
    setFeedback(null)
    notifySettingsDirtyChanged()
  }

  const updatePresentation = (row: SkillRow, patch: { alias?: string; icon?: SkillIconKey }) => {
    setPresentationDraft((previous) => {
      const merged = { ...previous[row.key], ...patch }
      const next = { ...previous }
      if (merged.alias !== undefined || merged.icon !== undefined) next[row.key] = merged
      else delete next[row.key]
      presentationDraftRef.current = next
      return next
    })
    setFeedback(null)
    notifySettingsDirtyChanged()
  }

  const openRow = (row: SkillRow, open: boolean) => {
    setOpenKey(open ? null : row.key)
    setDescDraft(row.description || '')
    setDescError('')
    setFeedback(null)
  }

  const saveDescription = async (row: SkillRow) => {
    if (!row.path) return
    setPendingAction(`description:${row.key}`)
    setDescError('')
    setFeedback(null)
    try {
      const saved = await ipcClient.invoke('skills.description.write', {
        key: row.key,
        description: descDraft,
      })
      if (!saved?.ok) throw new Error(String(saved?.error || t('settings:skills.editFailed')))
      setSkills((previous) =>
        previous.map((skill) => (skill.key === row.key ? { ...skill, description: descDraft.trim() } : skill)),
      )
      setFeedback({ key: row.key, kind: 'success', message: t('settings:skills.descriptionSaved') })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDescError(message)
      setFeedback({ key: row.key, kind: 'error', message })
    } finally {
      setPendingAction(null)
    }
  }

  const transfer = async (row: SkillRow, target: 'user' | 'project') => {
    if (!row.path) return
    setPendingAction(`transfer:${target}:${row.key}`)
    setFeedback(null)
    try {
      const response = await ipcClient.invoke('skills.transfer', { key: row.key, target, mode: 'copy' })
      if (!response?.ok) throw new Error(String(response?.error || t('settings:skills.copyFailed')))
      await load(true, true)
      setFeedback({
        key: row.key,
        kind: 'success',
        message: target === 'user' ? t('settings:skills.copiedUser') : t('settings:skills.copiedProject'),
      })
    } catch (error) {
      setFeedback({
        key: row.key,
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingAction(null)
    }
  }

  const filters: SkillFilter[] = ['all', 'enabled', 'disabled', 'user', 'project', 'readonly']

  return (
    <div className="w-full">
      <SettingsPageHeader
        title={t('settings:skills.title')}
        description={t('settings:skills.hint')}
        action={
          <button
            type="button"
            className="chrome-icon-btn flex h-11 w-11 items-center justify-center rounded-md"
            aria-label={t('common:refresh')}
            title={t('common:refresh')}
            disabled={loading}
            onClick={() => void load(false, true)}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.5} />
          </button>
        }
      />

      {!complete ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--warning-semantic)_28%,var(--border-base))] bg-[color-mix(in_srgb,var(--warning-semantic)_6%,transparent)] px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning-semantic)]" />
          <span>{t('settings:skills.incomplete')}</span>
        </div>
      ) : null}

      <div className="mb-4 space-y-2.5">
        <label className="relative block">
          <span className="sr-only">{t('settings:skills.search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/65" />
          <input
            className={cn(inputCls, 'min-h-11 pl-9 font-sans')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings:skills.search')}
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('settings:skills.filterLabel')}>
          {filters.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'settings-chip min-h-11 rounded-md border px-3 text-xs',
                filter === key
                  ? 'border-primary/45 bg-primary/8 font-medium text-foreground'
                  : 'border-border/70 text-muted-foreground',
              )}
            >
              {t(`settings:skills.filter.${key}`)}
            </button>
          ))}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/70">
            {t('settings:skills.catalogSummary', { enabled: enabledCount, total: skills.length })}
            {changedCount > 0 || presentationChanged
              ? ` · ${t('settings:skills.pendingChanges', { count: changedCount + (presentationChanged ? 1 : 0) })}`
              : ''}
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm text-destructive" role="alert">
          <span className="min-w-0 break-words">{loadError}</span>
          <button type="button" className={cn(btnOutline, 'min-h-11 shrink-0')} onClick={() => void load(false, true)}>
            {t('common:retry')}
          </button>
        </div>
      ) : loading ? (
        <div className="overflow-hidden rounded-lg border border-border/50" aria-label={t('common:loading')}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex min-h-[68px] items-center gap-3 border-b border-border/35 px-3 last:border-b-0">
              <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-36 animate-pulse rounded bg-muted/70" />
                <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted/45" />
              </div>
              <div className="h-5 w-10 animate-pulse rounded-full bg-muted/60" />
            </div>
          ))}
        </div>
      ) : displayRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
          <Search className="mx-auto h-5 w-5 text-muted-foreground/45" strokeWidth={1.5} />
          <p className="mt-2 text-sm font-medium text-foreground">{t('settings:skills.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t('settings:skills.emptyHint')}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border/50 bg-card/20">
          {displayRows.map((skill, index) => {
            const enabled = draft[skill.key] ?? skill.enabled
            const open = openKey === skill.key
            const changed = enabled !== (baseline[skill.key] ?? skill.enabled)
            const meta = presentationDraft[skill.key] || {}
            const displayName = meta.alias !== undefined ? meta.alias || skill.name : skill.alias || skill.name
            const Icon = skillIcon(meta.icon || skill.icon)
            const busyDescription = pendingAction === `description:${skill.key}`
            const busyUser = pendingAction === `transfer:user:${skill.key}`
            const busyProject = pendingAction === `transfer:project:${skill.key}`
            const detailsId = `skill-details-${index}`
            const switchLabel = enabled
              ? t('settings:skills.disableSkill', { name: displayName })
              : t('settings:skills.enableSkill', { name: displayName })

            return (
              <li key={skill.key} className="border-b border-border/40 last:border-b-0">
                <div className={cn('settings-skill-row flex items-center gap-3 px-3', !enabled && 'opacity-70')}>
                  <button
                    type="button"
                    className="interactive-row flex min-h-[68px] min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={() => openRow(skill, open)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/55 bg-background/70 text-muted-foreground">
                      <Icon className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <span className="min-w-0 flex-1 py-2">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[15px] font-medium text-foreground">{displayName}</span>
                        {changed ? (
                          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                            {t('settings:skills.pending')}
                          </span>
                        ) : null}
                        {skill.shadowed ? (
                          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                            {t('settings:skills.shadowed')}
                          </span>
                        ) : skill.effective ? (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-[color-mix(in_srgb,var(--success-semantic)_10%,transparent)] px-1.5 py-0.5 text-2xs text-[var(--success-semantic)]">
                            <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                            {t('settings:skills.effective')}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                        {skill.description || t('settings:skills.noDescription')}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-2xs text-muted-foreground/60">
                        <span>{skill.command}</span>
                        <span aria-hidden>·</span>
                        <span>{skill.scope === 'project' ? t('settings:skills.scopeProject') : t('settings:skills.scopeUser')}</span>
                        {skill.origin === 'package' ? <><span aria-hidden>·</span><span>{t('settings:skills.package')}</span></> : null}
                      </span>
                    </span>
                    <ChevronRight
                      className="settings-chevron h-4 w-4 shrink-0 text-muted-foreground/55"
                      data-open={open ? 'true' : 'false'}
                      strokeWidth={1.7}
                    />
                  </button>
                  <Switch
                    checked={enabled}
                    disabled={!!skill.shadowed || pendingAction != null}
                    aria-label={switchLabel}
                    onCheckedChange={() => toggle(skill)}
                  />
                </div>

                <div
                  id={detailsId}
                  className="settings-expand-grid"
                  data-open={open ? 'true' : 'false'}
                  aria-hidden={!open}
                >
                  <div className="settings-expand-inner">
                    {open ? (
                      <div className="settings-expand-content border-t border-border/35 bg-background/35 px-4 pb-4 pt-3 sm:pl-14">
                      <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
                        {(meta.alias || skill.alias) ? <><dt className="text-muted-foreground">{t('settings:skills.realName')}</dt><dd className="font-mono text-foreground">{skill.name}</dd></> : null}
                        <dt className="text-muted-foreground">{t('settings:skills.source')}</dt>
                        <dd className="text-foreground">{skill.source || skill.origin || '—'}</dd>
                        <dt className="text-muted-foreground">{t('settings:skills.path')}</dt>
                        <dd className="break-all font-mono text-foreground/85">{skill.path || '—'}</dd>
                      </dl>

                      <div className="mt-4 grid gap-4 border-t border-border/35 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-foreground">{t('settings:skills.aliasLabel')}</span>
                          <input
                            className={cn(inputCls, 'min-h-11 font-sans')}
                            value={meta.alias !== undefined ? meta.alias : skill.alias ?? ''}
                            placeholder={skill.name}
                            onChange={(event) => updatePresentation(skill, { alias: event.target.value })}
                          />
                          <span className="mt-1 block text-2xs text-muted-foreground/65">{t('settings:skills.aliasHint')}</span>
                        </label>
                        <fieldset>
                          <legend className="mb-1.5 text-xs font-medium text-foreground">{t('settings:skills.iconLabel')}</legend>
                          <div className="flex flex-wrap gap-1.5">
                            {SKILL_ICON_KEYS.map((iconKey) => {
                              const ChoiceIcon = skillIcon(iconKey)
                              const selected = (meta.icon || skill.icon || 'wrench') === iconKey
                              return (
                                <button
                                  key={iconKey}
                                  type="button"
                                  aria-pressed={selected}
                                  aria-label={t(`settings:skills.icon.${iconKey}`)}
                                  title={t(`settings:skills.icon.${iconKey}`)}
                                  className={cn(
                                    'settings-chip flex h-11 w-11 items-center justify-center rounded-md border',
                                    selected
                                      ? 'border-primary/45 bg-primary/8 text-foreground'
                                      : 'border-border/70 text-muted-foreground',
                                  )}
                                  onClick={() => updatePresentation(skill, { icon: iconKey })}
                                >
                                  <ChoiceIcon className="h-4 w-4" strokeWidth={1.7} />
                                </button>
                              )
                            })}
                          </div>
                          <span className="mt-1 block text-2xs text-muted-foreground/65">{t('settings:skills.iconHint')}</span>
                        </fieldset>
                      </div>

                      {skill.shadowed ? (
                        <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{t('settings:skills.shadowedHint')}</span>
                        </div>
                      ) : null}
                      {!skill.editable ? (
                        <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{t('settings:skills.readonlyHint')}</span>
                        </div>
                      ) : null}

                      {skill.path && (skill.canCopyToUser !== false || skill.canCopyToProject !== false) ? (
                        <div className="mt-4">
                          <div className="mb-2 text-xs font-medium text-foreground">{t('settings:skills.scopeActions')}</div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {skill.canCopyToUser !== false ? (
                              <button
                                type="button"
                                className={cn(btnOutline, 'min-h-11 justify-center sm:justify-start')}
                                disabled={pendingAction != null}
                                onClick={() => void transfer(skill, 'user')}
                              >
                                {busyUser ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : <Copy className="mr-1.5 inline h-3.5 w-3.5" />}
                                {t('settings:skills.copyUser')}
                              </button>
                            ) : null}
                            {skill.canCopyToProject !== false ? (
                              <button
                                type="button"
                                className={cn(btnOutline, 'min-h-11 justify-center sm:justify-start')}
                                disabled={pendingAction != null}
                                onClick={() => void transfer(skill, 'project')}
                              >
                                {busyProject ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : <Folder className="mr-1.5 inline h-3.5 w-3.5" />}
                                {t('settings:skills.copyProject')}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {skill.editable && skill.path ? (
                        <div className="mt-4 border-t border-border/35 pt-4">
                          <label htmlFor={`skill-description-${index}`} className="mb-1.5 block text-xs font-medium text-foreground">
                            {t('settings:skills.descriptionLabel')}
                          </label>
                          <textarea
                            id={`skill-description-${index}`}
                            className={cn(textareaCls, 'min-h-24 font-sans')}
                            value={descDraft}
                            onChange={(event) => {
                              setDescDraft(event.target.value)
                              setDescError('')
                              setFeedback(null)
                            }}
                            aria-invalid={!!descError}
                            aria-describedby={descError ? `skill-description-error-${index}` : undefined}
                          />
                          <div className="mt-2 flex min-h-11 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 flex-1">
                              {descError ? (
                                <p id={`skill-description-error-${index}`} className="text-xs text-destructive" role="alert">{descError}</p>
                              ) : feedback?.key === skill.key ? (
                                <p
                                  className={cn('text-xs', feedback.kind === 'success' ? 'text-[var(--success-semantic)]' : 'text-destructive')}
                                  role="status"
                                >
                                  {feedback.message}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground/65">{t('settings:skills.descriptionHint')}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              className={cn(btnPrimary, 'min-h-11 shrink-0')}
                              disabled={pendingAction != null || descDraft.trim() === skill.description.trim()}
                              onClick={() => void saveDescription(skill)}
                            >
                              {busyDescription ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}
                              {t('settings:skills.saveDescription')}
                            </button>
                          </div>
                        </div>
                      ) : feedback?.key === skill.key ? (
                        <p
                          className={cn('mt-3 text-xs', feedback.kind === 'success' ? 'text-[var(--success-semantic)]' : 'text-destructive')}
                          role="status"
                        >
                          {feedback.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
