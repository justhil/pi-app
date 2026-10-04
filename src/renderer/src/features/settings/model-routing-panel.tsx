import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { peekAvailableModels, refreshAvailableModels, subscribeAvailableModels } from '@renderer/lib/available-models-cache'
import { cn } from '@renderer/lib/utils'
import {
  ROUTER_PROVIDER,
  ROUTER_THINKING_LEVELS,
  defaultRouter,
  normalizeRouters,
  type ModelRouter,
  type RouteTarget,
  type RouterBranch,
  type RouterThinking,
} from '@shared/model-routers'
import { SettingsPageHeader } from './settings-shell'
import { Toggle } from './settings-page-shared'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'
import { btnCompact, btnOutline, inputCls, selectCls, textareaCls } from './settings-controls'

type ClassifierRow = { id: string; name: string; provider: string; available: boolean }
type ModelOption = { key: string; name: string; provider: string }
const ModelsContext = createContext<{ models: ModelOption[]; classifiers: ClassifierRow[] }>({ models: [], classifiers: [] })
const field = cn(inputCls, 'h-7 py-0 text-[12px]')
const BRANCH_H = 96
const BRANCH_GAP = 10

function Node({ title, hint, children, className, dataNode, invalid }: { title: string; hint?: string; children?: ReactNode; className?: string; dataNode?: string; invalid?: boolean }) {
  return (
    <div
      data-route-node={dataNode}
      data-invalid={invalid || undefined}
      className={cn('route-node rounded-lg border px-3 py-2', invalid && 'route-node-invalid', className)}
    >
      <div className="text-[12px] font-medium text-foreground">{title}</div>
      {hint ? <div className="text-[11.5px] leading-[1.45] text-foreground-secondary">{hint}</div> : null}
      {children ? <div className="mt-1.5 space-y-1.5">{children}</div> : null}
    </div>
  )
}

function Arrow({ height = 24 }: { height?: number }) {
  return (
    <svg width="28" height={height} className="shrink-0 text-border" aria-hidden>
      <path d={`M0 ${height / 2} H22`} stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path d={`M22 ${height / 2 - 3.5} L27 ${height / 2} L22 ${height / 2 + 3.5}`} stroke="currentColor" strokeWidth="1.25" fill="none" />
    </svg>
  )
}

/** Fans one input out to `count` branch rows of fixed height. */
function Fan({ count }: { count: number }) {
  const total = count * BRANCH_H + (count - 1) * BRANCH_GAP
  const mid = total / 2
  return (
    <svg width="36" height={total} className="shrink-0 text-border" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const y = i * (BRANCH_H + BRANCH_GAP) + BRANCH_H / 2
        return <path key={i} d={`M0 ${mid} C18 ${mid}, 14 ${y}, 32 ${y}`} stroke="currentColor" strokeWidth="1.25" fill="none" />
      })}
    </svg>
  )
}

/** Real chat models grouped by provider; a value missing from the catalog stays selectable and is marked. */
function ModelSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useTranslation()
  const { models } = useContext(ModelsContext)
  const groups = useMemo(() => {
    const by = new Map<string, ModelOption[]>()
    for (const m of models) by.set(m.provider, [...(by.get(m.provider) ?? []), m])
    return [...by.entries()]
  }, [models])
  const known = !value || models.some((m) => m.key === value)
  return (
    <select
      aria-label={label}
      className={cn(selectCls, 'settings-field h-7 w-full min-w-0 py-0 text-[12px]', !value && 'text-foreground-secondary')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('settings:routing.pickModel')}</option>
      {!known ? <option value={value}>{t('settings:routing.notInCatalog', { model: value })}</option> : null}
      {groups.map(([provider, list]) => (
        <optgroup key={provider} label={provider}>
          {list.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name && m.name !== m.key.slice(provider.length + 1) ? `${m.name} · ${m.key.slice(provider.length + 1)}` : m.key.slice(provider.length + 1)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function ThinkingSelect({ value, onChange, label }: { value: RouterThinking; onChange: (v: RouterThinking) => void; label: string }) {
  const { t } = useTranslation()
  return (
    <select aria-label={label} className={cn(selectCls, 'h-7 min-w-0 py-0 text-[12px]')} value={value} onChange={(e) => onChange(e.target.value as RouterThinking)}>
      <option value="inherit">{t('settings:routing.inherit')}</option>
      {ROUTER_THINKING_LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  )
}

function TargetFields({ target, onChange, label }: { target: RouteTarget; onChange: (t: RouteTarget) => void; label: string; listId?: string }) {
  return (
    <div className="grid grid-cols-[1fr_8rem] gap-1">
      <ModelSelect label={`${label} model`} value={target.model} onChange={(model) => onChange({ ...target, model })} />
      <ThinkingSelect label={`${label} thinking`} value={target.thinking} onChange={(thinking) => onChange({ ...target, thinking })} />
    </div>
  )
}

function OptionalTarget({
  title,
  hint,
  target,
  onChange,
  dataNode,
}: {
  title: string
  hint: string
  target: RouteTarget | null
  onChange: (t: RouteTarget | null) => void
  dataNode: string
}) {
  const { t } = useTranslation()
  return (
    <div
      data-route-node={dataNode}
      className={cn('route-node rounded-lg border px-3 py-2', !target && 'route-node-off', target && !target.model && 'route-node-invalid')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">{title}</div>
          <div className="text-[11.5px] leading-[1.45] text-foreground-secondary">{hint}</div>
        </div>
        <Toggle on={!!target} onChange={(on) => onChange(on ? { model: '', thinking: 'inherit' } : null)} />
      </div>
      {target ? (
        <div className="mt-1.5">
          <TargetFields label={title} target={target} onChange={onChange} />
          {!target.model ? <div className="mt-1 text-[11px] text-red-600/90 dark:text-red-400/90">{t('settings:routing.needModel')}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

const short = (key: string) => key.slice(key.indexOf('/') + 1) || key
const level = (t: RouteTarget, inherit: string) => (t.thinking === 'inherit' ? inherit : t.thinking)

/** One sentence that says what the router does, so the canvas reads at a glance. */
function RouterSummary({ router }: { router: ModelRouter }) {
  const { t } = useTranslation()
  const inherit = t('settings:routing.inheritShort')
  const target = (x: RouteTarget) => (x.model ? t('settings:routing.sumTarget', { model: short(x.model), level: level(x, inherit) }) : t('settings:routing.unset'))
  const parts: string[] = []
  if (router.classifier) {
    parts.push(
      t(router.classifyEachMessage ? 'settings:routing.sumEach' : 'settings:routing.sumFirst', { classifier: short(router.classifier) }) +
        router.branches.map((b) => `${b.label} → ${target(b)}`).join(t('settings:routing.sumSep')),
    )
    parts.push(t('settings:routing.sumFallback', { target: target(router.fallback) }))
  } else {
    parts.push(t('settings:routing.sumAlways', { target: target(router.fallback) }))
  }
  if (router.afterEdit) parts.push(t('settings:routing.sumAfterEdit', { target: target(router.afterEdit) }))
  if (router.retryOn) parts.push(t('settings:routing.sumRetry', { target: target(router.retryOn) }))
  return <p className="text-[12.5px] leading-[1.7] text-foreground" data-router-summary="">{parts.join(t('settings:routing.sumEnd'))}{t('settings:routing.sumEnd').trim()}</p>
}

function ClassifierSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const { classifiers } = useContext(ModelsContext)
  const known = !value || classifiers.some((c) => `${c.provider}/${c.id}` === value)
  const current = classifiers.find((c) => `${c.provider}/${c.id}` === value)
  const ordered = [...classifiers].sort((a, b) => Number(b.available) - Number(a.available))
  return (
    <>
      <select
        aria-label={t('settings:routing.classifier')}
        className={cn(selectCls, 'settings-field h-7 w-full min-w-0 py-0 text-[12px]')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('settings:routing.noClassifier')}</option>
        {!known ? <option value={value}>{t('settings:routing.notInCatalog', { model: value })}</option> : null}
        {ordered.map((c) => (
          <option key={`${c.provider}/${c.id}`} value={`${c.provider}/${c.id}`}>
            {`${c.provider} / ${c.name}`}
            {c.available ? '' : ` · ${t('settings:routing.noCredentials')}`}
          </option>
        ))}
      </select>
      {value && current && !current.available ? (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">{t('settings:routing.classifierNoKey', { provider: current.provider })}</div>
      ) : null}
      {classifiers.length === 0 ? <div className="text-[11px] text-foreground-secondary">{t('settings:routing.noClassifiers')}</div> : null}
    </>
  )
}

function RouterCanvas({ router, onChange }: { router: ModelRouter; onChange: (r: ModelRouter) => void }) {
  const { t } = useTranslation()
  const set = (patch: Partial<ModelRouter>) => onChange({ ...router, ...patch })
  const setBranch = (i: number, patch: Partial<RouterBranch>) => set({ branches: router.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  const classified = !!router.classifier
  const fallbackNode = (only: boolean) => (
    <Node
      title={t('settings:routing.fallback')}
      hint={t(only ? 'settings:routing.fallbackOnly' : 'settings:routing.fallbackHint')}
      className={cn(only ? 'w-80' : 'w-full', !only && 'route-node-soft')}
      dataNode="fallback"
      invalid={!router.fallback.model}
    >
      <TargetFields label="fallback" target={router.fallback} onChange={(fallback) => set({ fallback })} />
    </Node>
  )
  return (
    <div className="space-y-4" data-router={router.id}>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <label className="flex flex-col gap-1 text-[11.5px] text-foreground-secondary">
          {t('settings:routing.name')}
          <input className={cn(field, 'settings-field')} value={router.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-foreground-secondary">
          {t('settings:routing.id')}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[12px] text-foreground-secondary">{ROUTER_PROVIDER}/</span>
            <input className={cn(field, 'settings-field font-mono')} value={router.id} onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          </div>
        </label>
        <div className="flex h-7 items-center gap-2 text-[12px] text-foreground-secondary">
          {t('settings:routing.enabled')}
          <Toggle on={router.enabled} onChange={(enabled) => set({ enabled })} />
        </div>
      </div>

      <RouterSummary router={router} />

      <div className="route-canvas overflow-x-auto rounded-xl border p-5" data-routing-canvas="">
        <div className={cn('flex items-center', classified && 'min-w-[47rem]')}>
          <Node title={t('settings:routing.userMessage')} hint={t('settings:routing.userMessageHint')} className="w-36" dataNode="input" />
          <Arrow />
          <Node title={t('settings:routing.classifier')} hint={t('settings:routing.classifierHint')} className="w-64" dataNode="classifier">
            <ClassifierSelect value={router.classifier} onChange={(classifier) => set({ classifier })} />
            {classified ? (
              <>
                <textarea
                  aria-label={t('settings:routing.question')}
                  className={cn(textareaCls, 'settings-field h-16 resize-none px-2 py-1 font-sans text-[12px]')}
                  value={router.question}
                  onChange={(e) => set({ question: e.target.value })}
                />
                <label className="flex items-center justify-between gap-2 text-[12px] text-foreground">
                  {t('settings:routing.eachMessage')}
                  <Toggle on={router.classifyEachMessage} onChange={(classifyEachMessage) => set({ classifyEachMessage })} />
                </label>
              </>
            ) : null}
          </Node>
          {classified ? (
            <>
              <Fan count={router.branches.length + 1} />
              <div className="relative flex flex-col" style={{ gap: BRANCH_GAP }}>
                {router.branches.map((b, i) => (
                  <div key={i} style={{ height: BRANCH_H }} className="w-[19rem]" data-route-node="branch">
                    <div className={cn('route-node flex h-full flex-col justify-center gap-1 rounded-lg border px-3 py-1.5', !b.model && 'route-node-invalid')}>
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`branch ${i + 1} label`}
                          className={cn(field, 'settings-field w-28 font-mono')}
                          value={b.label}
                          onChange={(e) => setBranch(i, { label: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })}
                        />
                        <input
                          aria-label={`branch ${i + 1} criteria`}
                          className={cn(field, 'settings-field flex-1 font-sans')}
                          value={b.criteria}
                          placeholder={t('settings:routing.criteria')}
                          onChange={(e) => setBranch(i, { criteria: e.target.value })}
                        />
                        <button
                          type="button"
                          aria-label={t('common:delete')}
                          disabled={router.branches.length <= 2}
                          onClick={() => set({ branches: router.branches.filter((_, j) => j !== i) })}
                          className="chrome-icon-btn rounded-md p-1 text-foreground-secondary hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>
                      <TargetFields label={`branch ${i + 1}`} target={b} onChange={(tg) => setBranch(i, tg)} />
                    </div>
                  </div>
                ))}
                <div style={{ height: BRANCH_H }} className="flex w-[19rem] items-center">
                  {fallbackNode(false)}
                </div>
                <button
                  type="button"
                  className={cn(btnCompact, 'absolute -bottom-8 left-0')}
                  onClick={() => set({ branches: [...router.branches, { label: `branch${router.branches.length + 1}`, criteria: '', model: '', thinking: 'inherit' }] })}
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                  {t('settings:routing.addBranch')}
                </button>
              </div>
            </>
          ) : (
            <>
              <Arrow />
              {fallbackNode(true)}
            </>
          )}
        </div>

        <div className={cn('grid grid-cols-2 gap-3', classified ? 'mt-12 min-w-[47rem]' : 'mt-5')}>
          <OptionalTarget dataNode="after-edit" title={t('settings:routing.afterEdit')} hint={t('settings:routing.afterEditHint')} target={router.afterEdit} onChange={(afterEdit) => set({ afterEdit })} />
          <OptionalTarget dataNode="retry" title={t('settings:routing.retryOn')} hint={t('settings:routing.retryOnHint')} target={router.retryOn} onChange={(retryOn) => set({ retryOn })} />
        </div>
      </div>
    </div>
  )
}

export function ModelRoutingPanel() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<ModelRouter[] | null>(null)
  const [routers, setRouters] = useState<ModelRouter[]>([])
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [classifiers, setClassifiers] = useState<ClassifierRow[]>([])
  const models = useSyncExternalStore(subscribeAvailableModels, peekAvailableModels)

  useEffect(() => {
    void refreshAvailableModels().catch(() => {})
    void ipcClient.invoke('routers.classifiers').then((res: { models?: ClassifierRow[] }) => setClassifiers(res?.models ?? []))
    void ipcClient.invoke('routers.get').then((res: { routers?: ModelRouter[]; problems?: string[]; error?: string }) => {
      setSaved(res.routers ?? [])
      setRouters(res.routers ?? [])
      if (res.error || res.problems?.length) setMessage({ tone: 'error', text: [res.error, ...(res.problems ?? [])].filter(Boolean).join('\n') })
    })
  }, [])

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(routers)
  const problems = useMemo(() => normalizeRouters({ routers }).problems, [routers])
  const router = routers[selected]
  const physical = useMemo(
    () => models.filter((m) => m.provider !== ROUTER_PROVIDER).map((m) => ({ key: `${m.provider}/${m.id}`, name: m.name, provider: m.provider })),
    [models],
  )

  const save = async () => {
    if (problems.length) throw new Error(t('settings:routing.fixFirst'))
    setMessage(null)
    const res = (await ipcClient.invoke('routers.set', { routers })) as { ok: boolean; error?: string; routers?: ModelRouter[] }
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.error ?? 'error' })
      throw new Error(res.error ?? 'error')
    }
    setSaved(res.routers ?? routers)
    setRouters(res.routers ?? routers)
    setMessage({ tone: 'ok', text: t('settings:routing.saved') })
    void refreshAvailableModels().catch(() => {})
  }

  // Saved and discarded through the settings save bar, like the other pages.
  useSettingsDirtySlice({
    id: 'model-routing',
    label: t('settings:nav.routing'),
    isDirty: () => dirty,
    commit: save,
    discard: () => {
      if (saved) setRouters(saved)
    },
  })

  const add = () => {
    let n = routers.length + 1
    while (routers.some((r) => r.id === (n === 1 ? 'auto' : `auto-${n}`))) n++
    const r = defaultRouter(n === 1 ? 'auto' : `auto-${n}`)
    r.fallback = { model: physical[0]?.key ?? '', thinking: 'inherit' }
    // Preselect a classifier only when one has credentials, so a new router works right away.
    const ready = classifiers.find((c) => c.available && c.id.includes('jev')) ?? classifiers.find((c) => c.available)
    r.classifier = ready ? `${ready.provider}/${ready.id}` : ''
    setRouters([...routers, r])
    setSelected(routers.length)
  }

  return (
    <ModelsContext.Provider value={{ models: physical, classifiers }}>
      <div className="space-y-6" data-model-routing="">
        <SettingsPageHeader title={t('settings:routing.title')} description={t('settings:routing.description')} />
        {message ? (
          <p className={cn('-mt-3 whitespace-pre-wrap text-[12px]', message.tone === 'error' ? 'text-red-600/90 dark:text-red-400/90' : 'text-foreground-secondary')}>{message.text}</p>
        ) : null}

        <div className="flex gap-5">
          <div className="w-48 shrink-0 space-y-0.5">
            {routers.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                className={cn('flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]', i === selected && 'bg-[var(--bg-active)]')}
              >
                <span className={cn('text-[12.5px] text-foreground', !r.enabled && 'text-foreground-secondary')}>{r.name || r.id}</span>
                <span className="font-mono text-[11px] text-foreground-secondary">
                  {ROUTER_PROVIDER}/{r.id}
                </span>
              </button>
            ))}
            <button type="button" className={cn(btnOutline, 'mt-2 w-full text-[12px]')} onClick={add}>
              {t('settings:routing.add')}
            </button>
            {router ? (
              <button
                type="button"
                className={cn(btnCompact, 'w-full justify-center hover:text-destructive')}
                onClick={() => {
                  setRouters(routers.filter((_, i) => i !== selected))
                  setSelected(Math.max(0, selected - 1))
                }}
              >
                {t('settings:routing.remove')}
              </button>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            {router ? (
              <RouterCanvas router={router} onChange={(next) => setRouters(routers.map((r, i) => (i === selected ? next : r)))} />
            ) : (
              <p className="py-6 text-[12.5px] text-foreground-secondary">{t('settings:routing.empty')}</p>
            )}
          </div>
        </div>
      </div>
    </ModelsContext.Provider>
  )
}
