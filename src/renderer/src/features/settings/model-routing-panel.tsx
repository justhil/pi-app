import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
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

const KNOWN_CLASSIFIERS = [
  'typesafe/jev-latest',
  'openrouter/~typesafe/jev-latest',
  'cloudflare-workers-ai/@cf/cloudflare/clef',
  'cloudflare-workers-ai/@cf/cloudflare/clef-flash',
  'opencode/jev-1.13',
]
const field = cn(inputCls, 'h-7 py-0 text-[12px]')
const BRANCH_H = 96
const BRANCH_GAP = 10

function Node({ title, hint, children, className, dataNode }: { title: string; hint?: string; children?: ReactNode; className?: string; dataNode?: string }) {
  return (
    <div data-route-node={dataNode} className={cn('rounded-lg border border-border/70 bg-background px-3 py-2 shadow-[0_1px_0_rgba(0,0,0,0.02)]', className)}>
      <div className="text-[11px] text-muted-foreground">{title}</div>
      {hint ? <div className="text-[10.5px] leading-4 text-muted-foreground/60">{hint}</div> : null}
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

function ModelInput({ value, onChange, label, listId }: { value: string; onChange: (v: string) => void; label: string; listId: string }) {
  return <input aria-label={label} list={listId} className={cn(field, 'w-full')} value={value} placeholder="provider/model" onChange={(e) => onChange(e.target.value.trim())} />
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

function TargetFields({ target, onChange, label, listId }: { target: RouteTarget; onChange: (t: RouteTarget) => void; label: string; listId: string }) {
  return (
    <div className="grid grid-cols-[1fr_8rem] gap-1">
      <ModelInput label={`${label} model`} listId={listId} value={target.model} onChange={(model) => onChange({ ...target, model })} />
      <ThinkingSelect label={`${label} thinking`} value={target.thinking} onChange={(thinking) => onChange({ ...target, thinking })} />
    </div>
  )
}

function OptionalTarget({
  title,
  hint,
  target,
  onChange,
  listId,
  dataNode,
}: {
  title: string
  hint: string
  target: RouteTarget | null
  onChange: (t: RouteTarget | null) => void
  listId: string
  dataNode: string
}) {
  return (
    <div data-route-node={dataNode} className={cn('rounded-lg border border-border/70 bg-background px-3 py-2', !target && 'border-dashed bg-transparent')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{title}</div>
          <div className="text-[10.5px] leading-4 text-muted-foreground/60">{hint}</div>
        </div>
        <Toggle on={!!target} onChange={(on) => onChange(on ? { model: '', thinking: 'inherit' } : null)} />
      </div>
      {target ? (
        <div className="mt-1.5">
          <TargetFields label={title} listId={listId} target={target} onChange={onChange} />
        </div>
      ) : null}
    </div>
  )
}

function RouterCanvas({ router, onChange }: { router: ModelRouter; onChange: (r: ModelRouter) => void }) {
  const { t } = useTranslation()
  const listId = 'routing-models'
  const set = (patch: Partial<ModelRouter>) => onChange({ ...router, ...patch })
  const setBranch = (i: number, patch: Partial<RouterBranch>) => set({ branches: router.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  const classified = !!router.classifier
  return (
    <div className="space-y-4" data-router={router.id}>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {t('settings:routing.name')}
          <input className={field} value={router.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {t('settings:routing.id')}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11.5px] text-muted-foreground/70">{ROUTER_PROVIDER}/</span>
            <input className={cn(field, 'font-mono')} value={router.id} onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          </div>
        </label>
        <div className="flex h-7 items-center gap-2 text-[11.5px] text-foreground-secondary">
          {t('settings:routing.enabled')}
          <Toggle on={router.enabled} onChange={(enabled) => set({ enabled })} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-[var(--bg-hover)]/40 p-4" data-routing-canvas="">
        <div className="flex min-w-[52rem] items-center">
          <Node title={t('settings:routing.userMessage')} hint={t('settings:routing.userMessageHint')} className="w-36" dataNode="input" />
          <Arrow />
          <Node title={t('settings:routing.classifier')} hint={t('settings:routing.classifierHint')} className="w-60" dataNode="classifier">
            <input
              aria-label={t('settings:routing.classifier')}
              list="routing-classifiers"
              className={cn(field, 'w-full font-mono')}
              value={router.classifier}
              placeholder={t('settings:routing.noClassifier')}
              onChange={(e) => set({ classifier: e.target.value.trim() })}
            />
            <textarea
              aria-label={t('settings:routing.question')}
              className={cn(textareaCls, 'h-16 resize-none px-2 py-1 text-[11.5px] font-sans')}
              value={router.question}
              disabled={!classified}
              onChange={(e) => set({ question: e.target.value })}
            />
            <label className="flex items-center justify-between gap-2 text-[11px] text-foreground-secondary">
              {t('settings:routing.eachMessage')}
              <Toggle on={router.classifyEachMessage} disabled={!classified} onChange={(classifyEachMessage) => set({ classifyEachMessage })} />
            </label>
          </Node>
          {classified ? (
            <>
              <Fan count={router.branches.length + 1} />
              <div className="relative flex flex-col" style={{ gap: BRANCH_GAP }}>
                {router.branches.map((b, i) => (
                  <div key={i} style={{ height: BRANCH_H }} className="w-80" data-route-node="branch">
                    <div className="flex h-full flex-col justify-center gap-1 rounded-lg border border-border/70 bg-background px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`branch ${i + 1} label`}
                          className={cn(field, 'w-28 font-mono')}
                          value={b.label}
                          onChange={(e) => setBranch(i, { label: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })}
                        />
                        <input
                          aria-label={`branch ${i + 1} criteria`}
                          className={cn(field, 'flex-1 font-sans')}
                          value={b.criteria}
                          placeholder={t('settings:routing.criteria')}
                          onChange={(e) => setBranch(i, { criteria: e.target.value })}
                        />
                        <button
                          type="button"
                          aria-label={t('common:delete')}
                          disabled={router.branches.length <= 2}
                          onClick={() => set({ branches: router.branches.filter((_, j) => j !== i) })}
                          className="chrome-icon-btn rounded-md p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>
                      <TargetFields label={`branch ${i + 1}`} listId={listId} target={b} onChange={(tg) => setBranch(i, tg)} />
                    </div>
                  </div>
                ))}
                <div style={{ height: BRANCH_H }} className="flex w-80 items-center" data-route-node="fallback">
                  <Node title={t('settings:routing.fallback')} hint={t('settings:routing.fallbackHint')} className="w-full border-dashed">
                    <TargetFields label="fallback" listId={listId} target={router.fallback} onChange={(fallback) => set({ fallback })} />
                  </Node>
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
              <Node title={t('settings:routing.fallback')} hint={t('settings:routing.fallbackOnly')} className="w-80" dataNode="fallback">
                <TargetFields label="fallback" listId={listId} target={router.fallback} onChange={(fallback) => set({ fallback })} />
              </Node>
            </>
          )}
        </div>

        <div className={cn('grid max-w-[52rem] grid-cols-2 gap-3', classified ? 'mt-12' : 'mt-4')}>
          <OptionalTarget
            dataNode="after-edit"
            title={t('settings:routing.afterEdit')}
            hint={t('settings:routing.afterEditHint')}
            target={router.afterEdit}
            listId={listId}
            onChange={(afterEdit) => set({ afterEdit })}
          />
          <OptionalTarget
            dataNode="retry"
            title={t('settings:routing.retryOn')}
            hint={t('settings:routing.retryOnHint')}
            target={router.retryOn}
            listId={listId}
            onChange={(retryOn) => set({ retryOn })}
          />
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
  const models = useSyncExternalStore(subscribeAvailableModels, peekAvailableModels)

  useEffect(() => {
    void refreshAvailableModels().catch(() => {})
    void ipcClient.invoke('routers.get').then((res: { routers?: ModelRouter[]; problems?: string[]; error?: string }) => {
      setSaved(res.routers ?? [])
      setRouters(res.routers ?? [])
      if (res.error || res.problems?.length) setMessage({ tone: 'error', text: [res.error, ...(res.problems ?? [])].filter(Boolean).join('\n') })
    })
  }, [])

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(routers)
  const problems = useMemo(() => normalizeRouters({ routers }).problems, [routers])
  const router = routers[selected]
  const physical = models.filter((m) => m.provider !== ROUTER_PROVIDER)

  const save = async () => {
    if (problems.length) throw new Error(problems.join('\n'))
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
    const first = physical[0] ? `${physical[0].provider}/${physical[0].id}` : ''
    const r = defaultRouter(n === 1 ? 'auto' : `auto-${n}`)
    r.fallback = { model: first, thinking: 'inherit' }
    setRouters([...routers, r])
    setSelected(routers.length)
  }

  return (
    <div className="space-y-6" data-model-routing="">
      <SettingsPageHeader
        title={t('settings:routing.title')}
        description={t('settings:routing.description')}
      />
      {message ? (
        <p className={cn('-mt-3 whitespace-pre-wrap text-[12px]', message.tone === 'error' ? 'text-red-600/90 dark:text-red-400/90' : 'text-foreground-secondary')}>{message.text}</p>
      ) : null}
      {dirty && problems.length ? <p className="-mt-3 whitespace-pre-wrap text-[12px] text-amber-700 dark:text-amber-400">{problems.join('\n')}</p> : null}

      <div className="flex gap-5">
        <div className="w-48 shrink-0 space-y-0.5">
          {routers.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={cn('flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]', i === selected && 'bg-[var(--bg-active)]')}
            >
              <span className={cn('text-[12.5px] text-foreground', !r.enabled && 'text-muted-foreground')}>{r.name || r.id}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground/70">
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

      <datalist id="routing-models">
        {physical.map((m) => (
          <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="routing-classifiers">
        {KNOWN_CLASSIFIERS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  )
}
