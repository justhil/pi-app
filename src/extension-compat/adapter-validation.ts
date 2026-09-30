import { z } from 'zod'
import type { AdapterJson } from './adapter-schema'

const text = z.string().min(1)
const strings = z.array(text)
const field = z.object({
  key: text, type: z.enum(['text', 'secret', 'select', 'number', 'boolean']),
  label: z.string().optional(), description: z.string().optional(), default: z.unknown().optional(),
  options: strings.optional(), readOnly: z.boolean().optional(),
  optionsFrom: z.object({ url: text, itemsPath: text, headers: z.record(z.string()).optional(), valueFrom: text.optional(), labelFrom: text.optional(), timeoutMs: z.number().positive().max(60000).optional() }).passthrough().optional(),
}).passthrough()
const source = z.object({ type: z.literal('json'), path: text, itemsPath: z.string().optional(), fields: z.record(z.string()).optional() }).strict()
const schema = z.object({
  schemaVersion: z.literal(1).optional(), kind: z.enum(['plugin', 'desktop']).optional(),
  id: text, tier: z.enum(['native', 'partial', 'headless', 'none']),
  displayName: z.string().optional(), description: z.string().optional(),
  match: z.object({ names: strings.optional(), tools: strings.optional(), commands: strings.optional() }).strict().optional(),
  alwaysVisible: z.boolean().optional(),
  config: z.object({
    configFile: text.optional(), fileKeyMap: z.record(text).optional(), envOverride: z.record(text).optional(), localKeys: strings.optional(), piSettingsKey: text.optional(), customRenderer: text.optional(),
    sections: z.array(z.object({ title: z.string().optional(), fields: z.array(field).optional(), derived: z.array(z.object({ label: text, available: z.string().optional(), detail: z.string().optional() })).optional() }).passthrough()).optional(),
    actions: z.array(z.object({ id: text, type: z.enum(['httpCheck', 'openPath', 'reload']), url: z.string().optional(), method: z.string().optional(), headers: z.record(z.string()).optional(), timeoutMs: z.number().positive().max(60000).optional() }).passthrough()).optional(),
  }).passthrough().optional(),
  toolCard: z.object({ template: z.enum(['default', 'list', 'media', 'tree', 'kv', 'hashline']).optional(), fields: z.record(z.string()).optional(), statusField: z.string().optional(), protocol: text.optional() }).passthrough().optional(),
  interact: z.object({ trigger: z.object({ tool: text.optional(), argsMatch: z.record(z.unknown()).optional() }), schema: z.enum(['questions', 'clarify', 'review']), fields: z.record(z.string()).optional() }).strict().optional(),
  slash: z.record(z.enum(['notify', 'config-page', 'execute', 'open-panel'])).optional(),
  widget: z.object({ keys: strings.optional(), tools: strings.optional(), placement: z.literal('aboveComposer'), protocol: z.literal('todo-list-v1'), fields: z.record(z.string()).optional() }).passthrough().optional(),
  sidePanel: z.object({ stateProvider: text.optional(), panelComponent: text, panelId: text.optional(), source: source.optional(), label: z.string().optional(), description: z.string().optional(), icon: text.optional(), defaultEnabled: z.boolean().optional() }).strict().refine((panel) => !!panel.source !== !!panel.stateProvider, 'declare one source or stateProvider').optional(),
}).passthrough().superRefine((adapter, ctx) => {
  if (adapter.kind !== 'desktop' && !adapter.match) ctx.addIssue({ code: 'custom', path: ['match'], message: 'plugin adapter requires match' })
  if (adapter.kind === 'desktop' && !adapter.sidePanel) ctx.addIssue({ code: 'custom', path: ['sidePanel'], message: 'desktop contribution requires a panel' })
})

export function parseAdapterDeclaration(raw: unknown): { adapter: AdapterJson } | { error: string } {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
  return { adapter: { ...parsed.data, schemaVersion: 1, match: parsed.data.match ?? {} } as AdapterJson }
}

/** Package identities, not arbitrary substrings of display names. */
export function adapterIdentity(value: string): string {
  let name = value.trim().replace(/\\/g, '/').replace(/^package:/, '').replace(/^npm:/, '')
  const modules = name.lastIndexOf('/node_modules/')
  if (modules >= 0) {
    const parts = name.slice(modules + 14).split('/')
    name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  } else if (/^(git:|https?:)|github\.com\//.test(name)) {
    name = name.replace(/\.git(?:@.*)?$/, '').replace(/@[^/]*$/, '').split('/').pop() || name
  }
  return name.replace(/@[^/@]+$/, '').toLowerCase()
}
