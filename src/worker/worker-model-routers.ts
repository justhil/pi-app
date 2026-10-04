// Desktop model routers as pi virtual models (`router/<id>`). The config lives in
// <agentDir>/pi-desktop-routers.json (Settings → Model routing); Main asks every worker to reload
// it after a save. Routing decisions are in model-router-decide.ts.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext, InlineExtension } from '@earendil-works/pi-coding-agent'
import { ROUTER_PROVIDER, ROUTER_THINKING_LEVELS, ROUTERS_FILE, normalizeRouters, splitModelKey, type ModelRouter } from '@shared/model-routers'
import { decideRoute, type RouteReason, type RouterState } from './model-router-decide.js'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'

const EDIT_TOOLS = new Set(['edit', 'write'])

let api: ExtensionAPI | null = null
let agentDir = ''
const registered = new Set<string>()

type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean }
type Routed = { model: { provider: string; id: string }; thinkingLevel?: string }

export function readRouters(dir: string): ModelRouter[] {
  try {
    return normalizeRouters(JSON.parse(readFileSync(join(dir, ROUTERS_FILE), 'utf8'))).routers.filter((r) => r.enabled)
  } catch {
    return []
  }
}

export function lastUserText(messages: readonly Msg[]): string {
  const content = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map((b: { type?: string; text?: string }) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n') : ''
}

export function editedThisTurn(messages: readonly Msg[]): boolean {
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  return messages.slice(lastUser + 1).some((m) => m.role === 'toolResult' && EDIT_TOOLS.has(String(m.toolName)) && !m.isError)
}

const keyOf = (r?: Routed) => (r ? { model: `${r.model.provider}/${r.model.id}`, thinking: r.thinkingLevel } : undefined)

async function classify(router: ModelRouter, messages: readonly Msg[], ctx: ExtensionContext, signal?: AbortSignal): Promise<string | undefined> {
  const { provider, id } = splitModelKey(router.classifier)
  const registry = ctx.modelRegistry as unknown as {
    findOfType: (type: 'classifier', provider: string, id: string) => unknown
    classify: (model: unknown, context: unknown, options?: unknown) => Promise<{ stopReason?: string; answers?: Record<string, { type?: string; probabilities?: Record<string, number> }> }>
  }
  const model = registry.findOfType?.('classifier', provider, id)
  if (!model) return undefined
  const result = await registry.classify(
    model,
    {
      state: { prompt: lastUserText(messages).slice(0, 16_000) },
      questions: {
        route: { type: 'choice', instructions: router.question, criteria: Object.fromEntries(router.branches.map((b) => [b.label, b.criteria || b.label])) },
      },
    },
    { signal },
  )
  const answer = result.stopReason === 'stop' ? result.answers?.route : undefined
  if (answer?.type !== 'choice' || !answer.probabilities) return undefined
  return Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]
}

function register(pi: ExtensionAPI, router: ModelRouter): void {
  const registry = pi as unknown as { registerVirtualModel?: (def: unknown) => void }
  if (typeof registry.registerVirtualModel !== 'function') return
  registry.registerVirtualModel({
    provider: ROUTER_PROVIDER,
    id: router.id,
    name: router.name,
    thinkingLevels: [...ROUTER_THINKING_LEVELS],
    async route(
      request: { reason: RouteReason; thinkingLevel: string; previous?: Routed; failed?: Routed; state?: RouterState; messages: Msg[]; signal?: AbortSignal },
      ctx: ExtensionContext,
    ) {
      const decision = await decideRoute(
        router,
        {
          reason: request.reason,
          selectedThinking: request.thinkingLevel,
          previous: keyOf(request.previous),
          failed: keyOf(request.failed),
          state: request.state,
          editedThisTurn: editedThisTurn(request.messages),
        },
        (r) => classify(r, request.messages, ctx, request.signal),
      )
      const { provider, id } = splitModelKey(decision.model)
      const model = ctx.modelRegistry.find(provider, id)
      if (!model) throw new Error(`Model router "${router.name}": ${decision.model} is not in the model catalog`)
      return { model, thinkingLevel: decision.thinking, ...(decision.state ? { state: decision.state } : {}) }
    },
  })
  registered.add(router.id)
}

/** Re-read the routers file: register new and changed routers, remove deleted or disabled ones. */
export function applyRouters(): number {
  if (!api) return 0
  const routers = readRouters(agentDir)
  const unregister = (api as unknown as { unregisterVirtualModel?: (provider: string, id: string) => void }).unregisterVirtualModel
  for (const id of [...registered]) {
    if (!routers.some((r) => r.id === id)) {
      unregister?.call(api, ROUTER_PROVIDER, id)
      registered.delete(id)
    }
  }
  for (const r of routers) register(api, r)
  return routers.length
}

export function modelRoutersExtension(dir: string): InlineExtension {
  return {
    name: 'pi-desktop-model-routers',
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      api = pi
      agentDir = dir
      registered.clear()
      applyRouters()
    },
  }
}

export async function handleReloadModelRouters(_msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  reply({ ok: true, count: applyRouters() })
}
