import { CAPABILITY_IDS, normalizeCapabilities, type CapabilityId, type CapabilityInfo } from '@shared/capabilities'
import { BROWSER_TOOL_DEFS, BROWSER_TOOL_NAMES, leanSchema } from '@shared/browser-tools'
import piUiPrompt from './pi-ui.md?raw'

const BROWSER_TOOL_COUNT = BROWSER_TOOL_NAMES.length

/** Rough token estimate (~4 characters per token for English text and JSON). */
const estimateTokens = (chars: number) => Math.round(chars / 4)

/**
 * Tool definitions go out with every request, in the provider's function format. Count them
 * too: they are most of a tool capability's cost, far more than its prompt text.
 */
const TOOL_DEF_TOKENS: Partial<Record<CapabilityId, number>> = {
  browser: estimateTokens(
    JSON.stringify(BROWSER_TOOL_DEFS.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: leanSchema(d.parameters) } }))).length,
  ),
}

/** Prompt text appended to the system prompt while a capability is on (strip the source comment). */
const PROMPTS: Partial<Record<CapabilityId, string>> = {
  'pi-ui': piUiPrompt.replace(/^<!--[\s\S]*?-->\s*/, '').trim(),
  browser: [
    '# Built-in browser',
    'The browser_* tools drive the browser panel in pi Desktop. The user can watch and take over; its tabs keep the user\'s sign-ins. Tabs you open belong to this conversation.',
    '- Work from text, not pixels: browser_snapshot (browser_find on big pages) lists roles, names and refs like [ref=e12]; act with those refs. Action results show only what changed (### Changes), so a new snapshot is rarely needed. Use browser_take_screenshot only for layout or visual questions.',
    '- `target` takes a ref (e12) or a locator matching exactly one element: getByRole(\'button\', { name: \'Save\' }), getByText(\'Sign in\'), getByLabel(\'Email\'), getByPlaceholder(\'…\'), getByTestId(\'…\'), or CSS.',
    '- Elements behind a modal or banner have no ref: deal with the overlay first. "N more below" means scroll with browser_mouse_wheel.',
    '- browser_type replaces a field\'s text (slowly=true appends); use browser_fill_form for several fields.',
    '- Stay on the user\'s task. Ask before paying, posting, sending messages, deleting, or changing account settings.',
    '- If a page needs a login, CAPTCHA, 2FA or a dialog you cannot pass, stop and ask the user to handle it in the browser panel, then continue.',
  ].join('\n'),
}

/** Tool families a capability switches on in the worker (active tool set). */
const TOOL_FAMILIES: Partial<Record<CapabilityId, string>> = { browser: 'browser' }

let browserPanelEnabled: () => boolean = () => false

/** Main wires the live settings in at startup (kept out of this module so it stays importable in tests). */
export function configureCapabilities(opts: { browserPanelEnabled: () => boolean }): void {
  browserPanelEnabled = opts.browserPanelEnabled
}

function available(id: CapabilityId): { ok: boolean; reason?: string } {
  if (id === 'browser' && !browserPanelEnabled()) return { ok: false, reason: 'browser-panel-off' }
  return { ok: true }
}

export function capabilityCatalog(): CapabilityInfo[] {
  return CAPABILITY_IDS.map((id) => {
    const a = available(id)
    return {
      id,
      available: a.ok,
      ...(a.reason ? { reason: a.reason } : {}),
      promptTokens: estimateTokens(PROMPTS[id]?.length ?? 0) + (TOOL_DEF_TOKENS[id] ?? 0),
      tools: id === 'browser' ? BROWSER_TOOL_COUNT : 0,
    }
  })
}

const enabledAvailable = (raw: unknown) => {
  const enabled = normalizeCapabilities(raw)
  return CAPABILITY_IDS.filter((id) => enabled.includes(id) && available(id).ok)
}

/** Prompt sections for the enabled, available capabilities, in catalog order. */
export function capabilitySections(raw: unknown): string[] {
  return enabledAvailable(raw)
    .map((id) => PROMPTS[id])
    .filter((p): p is string => !!p)
}

/** Tool families to activate in the worker for the enabled, available capabilities. */
export function capabilityToolFamilies(raw: unknown): string[] {
  return enabledAvailable(raw)
    .map((id) => TOOL_FAMILIES[id])
    .filter((f): f is string => !!f)
}
