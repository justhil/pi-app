import { describe, expect, it, vi } from 'vitest'
import { defaultRouter, normalizeRouters, type ModelRouter } from '@shared/model-routers'
import { decideRoute, type RouteInput } from './model-router-decide'

const router = (patch: Partial<ModelRouter> = {}): ModelRouter => ({
  ...defaultRouter(),
  branches: [
    { label: 'complex', criteria: 'hard', model: 'oc/sol', thinking: 'high' },
    { label: 'standard', criteria: 'easy', model: 'oc/terra', thinking: 'inherit' },
  ],
  fallback: { model: 'oc/luna', thinking: 'medium' },
  ...patch,
})
const input = (patch: Partial<RouteInput> = {}): RouteInput => ({ reason: 'user', selectedThinking: 'low', editedThisTurn: false, ...patch })

describe('decideRoute', () => {
  it('classifies the first user message and stores the branch as state', async () => {
    const classify = vi.fn(async () => 'complex')
    expect(await decideRoute(router(), input(), classify)).toEqual({
      model: 'oc/sol',
      thinking: 'high',
      state: { phase: 'plan', model: 'oc/sol', thinking: 'high', branch: 'complex' },
    })
    const standard = await decideRoute(router(), input(), async () => 'standard')
    expect(standard).toMatchObject({ model: 'oc/terra', thinking: 'low' })
  })

  it('falls back when the classifier fails or answers something unknown', async () => {
    expect(await decideRoute(router(), input(), async () => undefined)).toMatchObject({ model: 'oc/luna', thinking: 'medium' })
    expect(await decideRoute(router(), input(), async () => Promise.reject(new Error('no key')))).toMatchObject({ model: 'oc/luna' })
    const noClassifier = vi.fn()
    expect(await decideRoute(router({ classifier: '' }), input(), noClassifier)).toMatchObject({ model: 'oc/luna' })
    expect(noClassifier).not.toHaveBeenCalled()
  })

  it('keeps the session model for later user messages unless every message is classified', async () => {
    const state = { phase: 'plan' as const, model: 'oc/sol', thinking: 'high' as const }
    const classify = vi.fn(async () => 'standard')
    expect(await decideRoute(router(), input({ state }), classify)).toEqual({ model: 'oc/sol', thinking: 'high' })
    expect(classify).not.toHaveBeenCalled()
    expect(await decideRoute(router({ classifyEachMessage: true }), input({ state }), classify)).toMatchObject({ model: 'oc/terra', state: { branch: 'standard' } })
  })

  it('switches once after the first edit when configured', async () => {
    const r = router({ afterEdit: { model: 'oc/luna', thinking: 'inherit' } })
    const plan = { phase: 'plan' as const, model: 'oc/sol', thinking: 'high' as const }
    expect(await decideRoute(r, input({ reason: 'continuation', state: plan }), vi.fn())).toEqual({ model: 'oc/sol', thinking: 'high' })
    expect(await decideRoute(r, input({ reason: 'continuation', state: plan, editedThisTurn: true }), vi.fn())).toEqual({
      model: 'oc/luna',
      thinking: 'low',
      state: { phase: 'build', model: 'oc/luna', thinking: 'inherit' },
    })
    const build = { phase: 'build' as const, model: 'oc/luna', thinking: 'inherit' as const }
    expect(await decideRoute(r, input({ reason: 'continuation', state: build, editedThisTurn: true }), vi.fn())).toEqual({ model: 'oc/luna', thinking: 'low' })
  })

  it('retries on the failed model or the configured retry model, and sends direct requests to the fallback', async () => {
    const failed = { model: 'oc/sol', thinking: 'high' }
    expect(await decideRoute(router(), input({ reason: 'retry', failed }), vi.fn())).toEqual({ model: 'oc/sol', thinking: 'high' })
    expect(await decideRoute(router({ retryOn: { model: 'an/opus', thinking: 'high' } }), input({ reason: 'retry', failed }), vi.fn())).toMatchObject({ model: 'an/opus' })
    expect(await decideRoute(router(), input({ reason: 'direct' }), vi.fn())).toMatchObject({ model: 'oc/luna', thinking: 'medium' })
  })
})

describe('normalizeRouters', () => {
  it('keeps valid routers and reports the rest', () => {
    const { routers, problems } = normalizeRouters({
      routers: [
        router({ id: 'auto' }),
        { ...router({ id: 'auto' }) },
        { ...router({ id: 'Bad Id' }) },
        { ...router({ id: 'nofb' }), fallback: { model: 'nope' } },
        { ...router({ id: 'onebranch' }), branches: [{ label: 'a', criteria: '', model: 'x/y', thinking: 'low' }] },
        { ...router({ id: 'plain', classifier: '' }), branches: [] },
      ],
    })
    expect(routers.map((r) => r.id)).toEqual(['auto', 'plain'])
    expect(problems).toHaveLength(4)
    expect(normalizeRouters({ routers: [{ ...router(), afterEdit: { model: 'bad' } }] }).routers[0].afterEdit).toBeNull()
  })
})
