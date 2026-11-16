// Session capabilities the user switched on in the composer's Tools menu (pi Desktop host feature).
// Main sends the prompt text of every enabled capability (keyed by capability id) before each
// prompt. The inline extension puts each one into pi's structured prompt sections as
// <desktop_{id}>…</desktop_{id}>: pi records section changes in the transcript and sends them as a
// system message after the cached prefix, so switching a capability on or off keeps the prompt
// cache. SDKs without structured sections fall back to appending to that turn's system prompt.
// See docs/architecture/adr/ADR-desktop-host-tools.md.

import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'
import {
  normalizePurgeMode,
  rewriteSystemPromptText,
  stripHostIdentity,
  type ActivePurgePayload,
} from '@shared/agent-purge'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { setBrowserToolsEnabled } from './worker-browser-tools.js'

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
  activePurge = {
    personaId: typeof obj.personaId === 'string' && obj.personaId ? obj.personaId : 'custom',
    personaName: typeof obj.personaName === 'string' && obj.personaName ? obj.personaName : 'Purge',
    mode: normalizePurgeMode(obj.mode, 'replace'),
    body,
  }
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
    if (typeof text === 'string' && text.trim()) sections[`${SECTION_PREFIX}${id.replace(/[^A-Za-z0-9_]/g, '_')}`] = text.trim()
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
export function withCapabilities(event: StartEvent): BeforeAgentStartEventResult | undefined {
  const opts = event.systemPromptOptions
  const target = opts?.sections
  if (target) {
    for (const key of Object.keys(target)) if (key.startsWith(SECTION_PREFIX) && !(key in sections)) delete target[key]
    for (const [key, text] of Object.entries(sections)) if (target[key] !== text) target[key] = text

    if (activePurge) {
      if (activePurge.mode === 'strict') {
        opts.customPrompt = activePurge.body
        delete target[PURGE_SECTION_KEY]
      } else {
        target[PURGE_SECTION_KEY] = activePurge.body
      }
    } else {
      delete target[PURGE_SECTION_KEY]
    }
    return undefined
  }

  const texts = Object.values(sections)
  const baseWithCaps = texts.length > 0 ? `${event.systemPrompt}\n\n${texts.join('\n\n')}` : event.systemPrompt
  if (activePurge) {
    return { systemPrompt: rewriteSystemPromptText(baseWithCaps, activePurge.body, activePurge.mode) }
  }
  if (texts.length === 0) return undefined
  return { systemPrompt: baseWithCaps }
}

/**
 * In `replace` mode on structured-section runtimes (Pi 1.5+), strip the default host identity
 * sentence from the outgoing request's `preamble` and place the persona at the very top while
 * avoiding sending the duplicate `agent_purge` section tag.
 */
export function projectReplacePurgeOnContextMessages(messages: unknown[]): void {
  if (!activePurge || activePurge.mode !== 'replace' || !Array.isArray(messages)) return
  const head = messages[0] as { role?: string; content?: unknown; sections?: Record<string, string | null> } | undefined
  if (!head || head.role !== 'system') return
  if (head.sections && typeof head.sections === 'object') {
    const rawPreamble = typeof head.sections.preamble === 'string' ? head.sections.preamble : ''
    const stripped = stripHostIdentity(rawPreamble)
    head.sections.preamble = stripped ? `${activePurge.body}\n\n${stripped}` : activePurge.body
    delete head.sections[PURGE_SECTION_KEY]
  } else if (typeof head.content === 'string') {
    head.content = rewriteSystemPromptText(head.content, activePurge.body, 'replace')
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
  reply({ ok: true, count: Object.keys(sections).length, purged: !!activePurge })
}
