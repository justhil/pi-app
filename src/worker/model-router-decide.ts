// Routing decisions for desktop model routers, kept free of pi types so they can be unit-tested.
// The worker extension (worker-model-routers.ts) adapts pi's route requests to this.

import type { ModelRouter, RouteTarget, RouterThinking } from '@shared/model-routers'

export type RouteReason = 'user' | 'continuation' | 'retry' | 'direct'

/** Router state pi keeps on the session branch. */
export interface RouterState {
  phase: 'plan' | 'build'
  model: string
  thinking: RouterThinking
  branch?: string
}

export interface RouteInput {
  reason: RouteReason
  /** Thinking level selected for the virtual model. */
  selectedThinking: string
  /** Physical model of the latest successful response, as provider/id. */
  previous?: { model: string; thinking?: string }
  /** For retries: the model that failed. */
  failed?: { model: string; thinking?: string }
  state?: RouterState
  /** A successful edit/write happened since the last user message. */
  editedThisTurn: boolean
}

export interface RouteDecision {
  model: string
  thinking: string
  /** New state to store; undefined keeps the current one. */
  state?: RouterState
}

/** Classifier call: the branch label it picked, or undefined when it is unavailable or failed. */
export type Classify = (router: ModelRouter) => Promise<string | undefined>

const resolve = (t: RouteTarget, selected: string) => (t.thinking === 'inherit' ? selected : t.thinking)

export async function decideRoute(router: ModelRouter, input: RouteInput, classify: Classify): Promise<RouteDecision> {
  const to = (t: RouteTarget, state?: RouterState): RouteDecision => ({ model: t.model, thinking: resolve(t, input.selectedThinking), state })
  const fromState = (s: RouterState): RouteDecision => ({ model: s.model, thinking: resolve(s, input.selectedThinking) })

  // Compaction summaries and other requests outside the agent loop.
  if (input.reason === 'direct') return to(router.fallback)

  // Retries stay on the failed model (valid cache and thinking signatures) unless a retry model is set.
  if (input.reason === 'retry') {
    if (router.retryOn) return to(router.retryOn)
    if (input.failed) return { model: input.failed.model, thinking: input.failed.thinking ?? input.selectedThinking }
    return input.state ? fromState(input.state) : to(router.fallback)
  }

  if (input.reason === 'continuation') {
    if (router.afterEdit && input.state?.phase === 'plan' && input.editedThisTurn) {
      return to(router.afterEdit, { phase: 'build', model: router.afterEdit.model, thinking: router.afterEdit.thinking })
    }
    if (input.state) return fromState(input.state)
    if (input.previous) return { model: input.previous.model, thinking: input.previous.thinking ?? input.selectedThinking }
    return to(router.fallback)
  }

  // A user message: keep the session's model unless this router classifies every message.
  if (input.state && !router.classifyEachMessage) return fromState(input.state)
  let chosen: RouteTarget = router.fallback
  let branch: string | undefined
  if (router.classifier && router.branches.length >= 2) {
    const label = await classify(router).catch(() => undefined)
    const hit = router.branches.find((b) => b.label === label)
    if (hit) {
      chosen = hit
      branch = hit.label
    }
  }
  const state: RouterState = { phase: 'plan', model: chosen.model, thinking: chosen.thinking, ...(branch ? { branch } : {}) }
  const same = input.state && input.state.model === state.model && input.state.thinking === state.thinking && input.state.phase === 'plan'
  return to(chosen, same ? undefined : state)
}
