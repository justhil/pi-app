// Session capabilities the user switched on in the composer's Tools menu (pi Desktop host feature)
// plus per-session Agent Purge v2 (persona + primer demonstration + in-memory refusal scrubbing).

import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'
import {
  DEFAULT_PURGE_STRATEGY,
  normalizeCustomTerms,
  normalizePrimerTurns,
  normalizePurgeMode,
  normalizePurgeStrategy,
  personaLanguage,
  rewriteSystemPromptText,
  stripHostIdentity,
  type ActivePurgePayload,
} from '@shared/agent-purge'
import { getMainUiLanguage } from '@shared/main-language'
import {
  buildThinkingAnchorDirective,
  injectPrimerTurnsIntoContext,
  scrubContextMessagesInMemory,
} from '@shared/purge-transforms'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { setBrowserToolsEnabled } from './worker-browser-tools.js'
import { setCanvasToolsEnabled } from './worker-canvas-tools.js'

const SECTION_PREFIX = 'desktop_'
const PURGE_SECTION_KEY = 'agent_purge'
let sections: Record<string, string> = {}
let activePurge: ActivePurgePayload | null = null

export function setActiveSessionPurge(next: unknown): void {
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    activePurge = null
    return
  }
  const obj = next as Record<string, unknown>
  const body = typeof obj.body === 'string' ? obj.body.trim() : ''
  if (!body) {
    activePurge = null
    return
  }
  const primerTurns = normalizePrimerTurns(obj.primerTurns)
  const retryFallbackModel =
    typeof obj.retryFallbackModel === 'string' && obj.retryFallbackModel.trim()
      ? obj.retryFallbackModel.trim()
      : undefined
  const customTerms = normalizeCustomTerms(obj.customTerms)

  activePurge = {
    personaId: typeof obj.personaId === 'string' && obj.personaId ? obj.personaId : 'custom',
    personaName: typeof obj.personaName === 'string' && obj.personaName ? obj.personaName : 'Purge',
    mode: normalizePurgeMode(obj.mode, 'replace'),
    body,
    ...(primerTurns ? { primerTurns } : {}),
    strategy: normalizePurgeStrategy(obj.strategy, DEFAULT_PURGE_STRATEGY),
    ...(retryFallbackModel ? { retryFallbackModel } : {}),
    ...(customTerms.length > 0 ? { customTerms } : {}),
  }
}

export function getActiveSessionPurge(): Readonly<ActivePurgePayload> | null {
  return activePurge
}

export function activeSessionPurgeForTest(): Readonly<ActivePurgePayload> | null {
  return activePurge
}

/** Capability id → prompt text. An array (older Main) is keyed by position. */
export function setCapabilitySections(next: unknown): void {
  const entries: [string, unknown][] = Array.isArray(next)
    ? next.map((v, i) => [`capability_${i}`, v])
    : next && typeof next === 'object'
      ? Object.entries(next as Record<string, unknown>)
      : []
  sections = {}
  for (const [id, text] of entries) {
    if (typeof text === 'string' && text.trim()) {
      sections[`${SECTION_PREFIX}${id.replace(/[^A-Za-z0-9_]/g, '_')}`] = text.trim()
    }
  }
}

export function capabilitySectionsForTest(): Readonly<Record<string, string>> {
  return sections
}

type StartEvent = Pick<BeforeAgentStartEvent, 'systemPrompt'> & {
  systemPromptOptions?: {
    customPrompt?: string
    sections?: Record<string, string>
  }
}

/**
 * Bring this turn's prompt sections in line with the enabled capabilities and per-session Agent Purge.
 * With structured sections nothing is returned (pi renders the change as a transcript delta);
 * otherwise the sections are rewritten onto the system prompt of this turn only.
 */
function composePurgeBodyWithThinking(purge: Readonly<ActivePurgePayload>): string {
  if (purge.strategy.thinkingGuidance !== 'anchor') return purge.body
  if (
    purge.body.includes('[思维链锚定]') ||
    purge.body.includes('[THINKING ANCHOR]') ||
    purge.body.includes('[ЯКОРЬ МЫШЛЕНИЯ]')
  ) {
    return purge.body
  }
  const lang = personaLanguage(getMainUiLanguage())
  const directive = buildThinkingAnchorDirective({
    personaId: purge.personaId,
    personaName: purge.personaName,
    lang,
  })
  return `${purge.body}\n\n${directive}`
}

export function withCapabilities(event: StartEvent): BeforeAgentStartEventResult | undefined {
  const opts = event.systemPromptOptions
  const target = opts?.sections
  if (target) {
    for (const key of Object.keys(target)) {
      if (key.startsWith(SECTION_PREFIX) && !(key in sections)) delete target[key]
    }
    for (const [key, text] of Object.entries(sections)) {
      if (target[key] !== text) target[key] = text
    }

    if (activePurge) {
      const effectiveBody = composePurgeBodyWithThinking(activePurge)
      if (activePurge.mode === 'strict') {
        opts.customPrompt = effectiveBody
        delete target[PURGE_SECTION_KEY]
      } else {
        target[PURGE_SECTION_KEY] = effectiveBody
      }
    } else {
      delete target[PURGE_SECTION_KEY]
    }
    return undefined
  }

  const texts = Object.values(sections)
  const baseWithCaps = texts.length > 0 ? `${event.systemPrompt}\n\n${texts.join('\n\n')}` : event.systemPrompt
  if (activePurge) {
    return {
      systemPrompt: rewriteSystemPromptText(
        baseWithCaps,
        composePurgeBodyWithThinking(activePurge),
        activePurge.mode,
      ),
    }
  }
  if (texts.length === 0) return undefined
  return { systemPrompt: baseWithCaps }
}

/**
 * Apply in-memory pre-flight transformations on `context_with_system`:
 * 1. `replace` mode: strip default host identity from `preamble` and place persona at the top.
 * 2. `scrubHistory`: neutralize prior soft-refusal assistant turns and compaction safety clauses.
 * 3. `primerEnabled`: inject static in-context demonstration turns right after leading system message(s).
 */
export function projectReplacePurgeOnContextMessages(messages: unknown[]): void {
  if (!activePurge || !Array.isArray(messages) || messages.length === 0) return

  if (activePurge.mode === 'replace') {
    const effectiveBody = composePurgeBodyWithThinking(activePurge)
    const head = messages[0] as { role?: string; content?: unknown; sections?: Record<string, string | null> } | undefined
    if (head && head.role === 'system') {
      if (head.sections && typeof head.sections === 'object') {
        const rawPreamble = typeof head.sections.preamble === 'string' ? head.sections.preamble : ''
        const stripped = stripHostIdentity(rawPreamble)
        head.sections.preamble = stripped ? `${effectiveBody}\n\n${stripped}` : effectiveBody
        delete head.sections[PURGE_SECTION_KEY]
      } else if (typeof head.content === 'string') {
        head.content = rewriteSystemPromptText(head.content, effectiveBody, 'replace')
      }
    }
  }

  const lang = personaLanguage(getMainUiLanguage())
  let next: unknown[] = messages
  if (activePurge.strategy.scrubHistory) {
    next = scrubContextMessagesInMemory(next, lang)
  }
  if (activePurge.strategy.primerEnabled && activePurge.primerTurns?.length) {
    next = injectPrimerTurnsIntoContext(next, activePurge.primerTurns)
  }
  if (next !== messages) {
    messages.splice(0, messages.length, ...next)
  }
}

export const capabilitiesExtension: InlineExtension = {
  name: 'pi-desktop-capabilities',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event) => withCapabilities(event))
    try {
      ;(pi as unknown as { on: (name: string, fn: (ev: { messages?: unknown[] }) => void) => void }).on(
        'context_with_system',
        (ev) => {
          if (Array.isArray(ev?.messages)) projectReplacePurgeOnContextMessages(ev.messages)
        },
      )
    } catch {
      /* Older Pi SDKs without context_with_system use before_agent_start fallback */
    }
  },
}

export async function handleSetCapabilities(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  setCapabilitySections(msg.sections)
  setActiveSessionPurge((msg as { purge?: unknown }).purge)
  const tools = Array.isArray(msg.tools) ? msg.tools : []
  setBrowserToolsEnabled(tools.includes('browser'))
  setCanvasToolsEnabled(tools.includes('canvas'))
  reply({ ok: true, count: Object.keys(sections).length, purged: !!activePurge })
}
