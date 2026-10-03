// Session capabilities the user switched on in the composer's Tools menu (pi Desktop host feature).
// Main sends the prompt text of every enabled capability before each prompt; the inline extension
// appends it to the system prompt of that turn only. Nothing enabled → nothing returned, so the
// system prompt is exactly what pi built. See docs/architecture/adr/ADR-desktop-host-tools.md.

import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'

let sections: string[] = []

export function setCapabilitySections(next: unknown): void {
  sections = Array.isArray(next) ? next.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
}

export function capabilitySectionsForTest(): readonly string[] {
  return sections
}

/** System prompt for this turn, or undefined to leave pi's prompt untouched. */
export function withCapabilities(event: Pick<BeforeAgentStartEvent, 'systemPrompt'>): BeforeAgentStartEventResult | undefined {
  if (sections.length === 0) return undefined
  return { systemPrompt: `${event.systemPrompt}\n\n${sections.join('\n\n')}` }
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
  reply({ ok: true, count: sections.length })
}
