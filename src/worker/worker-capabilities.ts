// Session capabilities the user switched on in the composer's Tools menu (pi Desktop host feature).
// Main sends the prompt text of every enabled capability (keyed by capability id) before each
// prompt. The inline extension puts each one into pi's structured prompt sections as
// <desktop_{id}>…</desktop_{id}>: pi records section changes in the transcript and sends them as a
// system message after the cached prefix, so switching a capability on or off keeps the prompt
// cache. SDKs without structured sections fall back to appending to that turn's system prompt.
// See docs/architecture/adr/ADR-desktop-host-tools.md.

import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { setBrowserToolsEnabled } from './worker-browser-tools.js'

const SECTION_PREFIX = 'desktop_'
let sections: Record<string, string> = {}

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

type StartEvent = Pick<BeforeAgentStartEvent, 'systemPrompt'> & { systemPromptOptions?: { sections?: Record<string, string> } }

/**
 * Bring this turn's prompt sections in line with the enabled capabilities. With structured
 * sections nothing is returned (pi renders the change as a transcript delta); otherwise the
 * sections are appended to the system prompt of this turn only.
 */
export function withCapabilities(event: StartEvent): BeforeAgentStartEventResult | undefined {
  const target = event.systemPromptOptions?.sections
  if (target) {
    for (const key of Object.keys(target)) if (key.startsWith(SECTION_PREFIX) && !(key in sections)) delete target[key]
    for (const [key, text] of Object.entries(sections)) if (target[key] !== text) target[key] = text
    return undefined
  }
  const texts = Object.values(sections)
  if (texts.length === 0) return undefined
  return { systemPrompt: `${event.systemPrompt}\n\n${texts.join('\n\n')}` }
}

export const capabilitiesExtension: InlineExtension = {
  name: 'pi-desktop-capabilities',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event) => withCapabilities(event))
  },
}

export async function handleSetCapabilities(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
  setCapabilitySections(msg.sections)
  const tools = Array.isArray(msg.tools) ? msg.tools : []
  setBrowserToolsEnabled(tools.includes('browser'))
  reply({ ok: true, count: Object.keys(sections).length })
}
