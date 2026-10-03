// Model picker panel: models grouped by provider (sorted), collapsed by default.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { Search, Check, ChevronRight, Loader2 } from '@renderer/components/icons'
import { toast } from 'sonner'
import { userActionToast } from '@renderer/lib/startup-toast-guard'
import { readRecentModels, rememberRecentModel } from '@renderer/lib/recent-models'
import { ComposerPopover } from './composer-popover'
import {
  peekAvailableModels,
  refreshAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { commitSessionDisplayMeta } from '@renderer/lib/session-display-meta'
import { boundThinkingLevelFor, loadModelThinkingBindings } from '@renderer/lib/model-thinking-bindings'

type ModelRow = { id: string; provider: string; name?: string; available?: boolean }

// 跨卸载的模型切换请求状态：picker 关闭后 App 条件卸载组件，局部 state 会丢失；
// 旧请求晚结算时可能覆盖用户随后发起的新选择，或污染已切换会话的 runState。
// 用模块级 pending + 递增 token：过期结果（更新选择 / 已切会话）一律忽略。
type PendingModelSwitch = {
  token: number
  sessionFile: string
  requestedModel: string
}
let modelSwitchToken = 0
let pendingModelSwitch: PendingModelSwitch | null = null

function groupByProvider(models: ModelRow[]): { provider: string; models: ModelRow[] }[] {
  const map = new Map<string, ModelRow[]>()
  for (const m of models) {
    const p = m.provider || 'unknown'
    const list = map.get(p)
    if (list) list.push(m)
    else map.set(p, [m])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, rows]) => ({
      provider,
      models: rows.sort((x, y) => x.id.localeCompare(y.id)),
    }))
}

export function ModelPicker() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.modelPickerOpen)
  const setOpen = useUIStore((s) => s.setModelPickerOpen)
  const currentModel = useUIStore((s) => s.runState.model)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const [models, setModels] = useState<ModelRow[]>(() => peekAvailableModels())
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>(() => readRecentModels())
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const reload = () => refreshAvailableModels().catch(() => peekAvailableModels())

  useEffect(() => subscribeAvailableModels(setModels), [])

  useEffect(() => {
    if (!open) return
    setModels(peekAvailableModels())
    setQuery('')
    setExpanded({})
    setRecents(readRecentModels())
    setActiveIndex(0)
    void loadModelThinkingBindings()
    void reload()
    const unsub = onAppEvent((event) => {
      // Worker bound a session and pushed its runtime model state → the picker's
      // earlier SDK fallback may have been empty (worker not ready yet). Reload.
      if (event?.type !== 'run') return
      if (event.phase !== 'state' && event.phase !== 'started') return
      void reload()
    })
    return unsub
  }, [open])

  const filtered = useMemo(() => {
    if (!query) return models
    const q = query.toLowerCase()
    return models.filter(
      (m) =>
        `${m.provider}/${m.id}`.toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    )
  }, [models, query])

  const groups = useMemo(() => groupByProvider(filtered), [filtered])

  const searching = query.trim().length > 0

  const pick = async (m: ModelRow) => {
    const requestedModel = `${m.provider}/${m.id}`
    if (!sessionFile) {
      // Draft session: preview the model's bound thinking level (applied for real on creation).
      const bound = boundThinkingLevelFor(requestedModel)
      useUIStore.getState().setRunState({ model: requestedModel, ...(bound ? { thinkingLevel: bound } : {}) })
      setRecents(rememberRecentModel(requestedModel))
      setOpen(false)
      return
    }
    const targetFile = sessionFile
    // 切换期间保持打开并禁用其它行，runtime 确认后才关闭/更新（上游语义）。
    // 请求可能跨 picker 关闭/重开、或用户切换会话后结算：用 token + session 守卫忽略过期结果。
    const token = ++modelSwitchToken
    pendingModelSwitch = { token, sessionFile: targetFile, requestedModel }
    setPendingModel(requestedModel)
    try {
      const response = await ipcClient.invoke('model.set', {
        sessionId: '',
        sessionFile: targetFile,
        provider: m.provider,
        modelId: m.id,
      })
      if (token !== modelSwitchToken) return
      const now = useUIStore.getState()
      if (!sessionFilesEqual(now.historySessionFile, targetFile)) return
      const actualModel = response.modelId || requestedModel
      now.setRunState({ model: actualModel })
      commitSessionDisplayMeta(targetFile, { model: actualModel })
      setRecents(rememberRecentModel(actualModel))
      if (pendingModelSwitch?.token === token) pendingModelSwitch = null
      setOpen(false)
      // Boot guard silences toast.success for the first 22s after launch; a
      // user-initiated model switch must still confirm visibly.
      userActionToast.success(t('composer:switchedModel', { key: actualModel }))
    } catch (e) {
      if (token !== modelSwitchToken) return
      const now = useUIStore.getState()
      if (!sessionFilesEqual(now.historySessionFile, targetFile)) return
      if (pendingModelSwitch?.token === token) pendingModelSwitch = null
      console.error('model.set failed:', e)
      toast.error(e instanceof Error ? e.message : t('composer:switchFailed'))
    } finally {
      if (token === modelSwitchToken) setPendingModel(null)
    }
  }

  const toggleProvider = (provider: string) => {
    setExpanded((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  const isProviderOpen = (provider: string) => {
    if (searching) return true
    return !!expanded[provider]
  }

  // Rows reachable by ↑/↓: recents first (when not searching), then every row of open groups.
  const recentRows = useMemo(
    () =>
      searching
        ? []
        : recents
            .map((key) => models.find((m) => `${m.provider}/${m.id}` === key))
            .filter((m): m is ModelRow => !!m),
    [recents, models, searching],
  )
  const navRows = useMemo(
    () => [...recentRows, ...groups.flatMap((g) => (isProviderOpen(g.provider) ? g.models : []))],
    [recentRows, groups, expanded, searching],
  )

  useEffect(() => setActiveIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-nav-active]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (navRows.length === 0) return
      setActiveIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + navRows.length) % navRows.length)
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const row = navRows[activeIndex]
      if (row && pendingModel === null) void pick(row)
    }
  }

  const renderRow = (m: ModelRow, navIndex: number, indent: boolean) => {
    const key = `${m.provider}/${m.id}`
    const active = currentModel === key
    const pending = pendingModel === key
    const focused = navIndex === activeIndex
    return (
      <button
        key={`${indent ? 'g' : 'r'}:${key}`}
        type="button"
        onClick={() => pick(m)}
        onMouseMove={() => setActiveIndex(navIndex)}
        disabled={pendingModel !== null}
        aria-busy={pending}
        data-nav-active={focused || undefined}
        className={cn(
          'picker-row flex w-full items-center gap-2 py-1.5 pr-3 text-left disabled:cursor-wait disabled:opacity-70',
          indent ? 'pl-8' : 'pl-3',
          focused && 'bg-[var(--bg-hover)]',
          active && 'bg-[var(--bg-active)]',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12px]">{m.id}</span>
            {!m.available && (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                {t('composer:unavailable')}
              </span>
            )}
          </div>
          {!indent || (m.name && m.name !== m.id) ? (
            <div className="truncate text-[10.5px] text-muted-foreground/60">
              {indent ? m.name : m.provider}
            </div>
          ) : null}
        </div>
        {pending
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          : active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </button>
    )
  }

  let navCursor = recentRows.length
  return (
    <ComposerPopover
      anchorSelector="[data-composer-model-chip]"
      width={360}
      label={t('composer:selectModelTitle')}
      onClose={() => setOpen(false)}
    >
      <div className="border-b border-border/60 px-2.5 py-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t('composer:searchModelPlaceholder')}
            aria-label={t('composer:searchModelPlaceholder')}
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/50">
            {models.length === 0 ? t('composer:noModels') : t('composer:noMatch')}
          </div>
        )}
        {recentRows.length > 0 ? (
          <>
            <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium text-muted-foreground/70">{t('composer:recentModels')}</div>
            {recentRows.map((m, i) => renderRow(m, i, false))}
            <div className="mx-3 my-1 border-t border-border/40" />
            <div className="px-3 pb-0.5 pt-1 text-[10.5px] font-medium text-muted-foreground/70">{t('composer:allModels')}</div>
          </>
        ) : null}
        {groups.map(({ provider, models: rows }) => {
          const openGroup = isProviderOpen(provider)
          const activeInGroup = rows.some((m) => currentModel === `${m.provider}/${m.id}`)
          const firstNav = navCursor
          if (openGroup) navCursor += rows.length
          return (
            <div key={provider} className="model-picker-provider">
              <button
                type="button"
                className="model-picker-provider-header interactive-row flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
                onClick={() => toggleProvider(provider)}
                aria-expanded={openGroup}
              >
                <ChevronRight className="settings-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" data-open={openGroup} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{provider}</span>
                {activeInGroup && !openGroup && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {t('composer:providerModelCount', { count: rows.length })}
                </span>
              </button>
              {openGroup ? rows.map((m, i) => renderRow(m, firstNav + i, true)) : null}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground/60">
        <span>{t('composer:modelCount', { total: models.length, shown: filtered.length })}</span>
        <span>{t('composer:modelPickerKeys')}</span>
      </div>
    </ComposerPopover>
  )
}
