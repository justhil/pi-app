import { z } from 'zod'
import { TODO_STATUSES } from '@shared/todo-list'
import type { AdapterJson } from './adapter-schema'

const text = z.string().min(1)
const strings = z.array(text)
const pattern = text.refine((value) => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}, 'invalid regular expression')
const field = z.object({
  key: text, type: z.enum(['text', 'secret', 'select', 'number', 'boolean']),
  label: z.string().optional(), description: z.string().optional(), default: z.unknown().optional(),
  options: strings.optional(), readOnly: z.boolean().optional(),
  optionsFrom: z.object({ url: text, itemsPath: text, headers: z.record(z.string()).optional(), valueFrom: text.optional(), labelFrom: text.optional(), timeoutMs: z.number().positive().max(60000).optional() }).passthrough().optional(),
}).passthrough()
const safeDirSegment = text.refine(
  (value) => !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0'),
  'must be a single safe directory name',
)
const statusBarFieldKeys = z.enum([
  'id',
  'command',
  'cwd',
  'status',
  'exitCode',
  'createdAt',
  'updatedAt',
  'outputPath',
  'lineCount',
  'tail',
  'timeoutSeconds',
  'error',
])
const statusBar = z
  .object({
    protocol: z.enum(['background-jobs-v1', 'status-pill-v1']),
    statusKeys: strings.optional(),
    tools: strings.optional(),
    exitMessageTypes: strings.optional(),
    actions: z
      .object({
        inspectTool: text.optional(),
        killTool: text.optional(),
      })
      .strict()
      .optional(),
    logFile: z
      .object({
        dirName: safeDirSegment,
        filePattern: pattern,
      })
      .strict()
      .optional(),
    fields: z.record(statusBarFieldKeys, text).optional(),
    icon: text.optional(),
    title: z.string().optional(),
    clickAction: z
      .object({
        type: z.enum(['none', 'slash', 'open-panel', 'config-page']),
        command: text.optional(),
        panelId: text.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((sb, ctx) => {
    if (sb.protocol === 'status-pill-v1' && (!sb.statusKeys || sb.statusKeys.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['statusKeys'], message: 'status-pill-v1 requires non-empty statusKeys' })
    }
    if (
      sb.protocol === 'background-jobs-v1' &&
      !sb.tools?.length &&
      !sb.exitMessageTypes?.length &&
      !sb.statusKeys?.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tools'],
        message: 'background-jobs-v1 requires at least one tool, exitMessageType, or statusKey',
      })
    }
    if (sb.clickAction?.type === 'slash' && !sb.clickAction.command) {
      ctx.addIssue({ code: 'custom', path: ['clickAction', 'command'], message: 'slash clickAction requires command' })
    }
  })
const installSource = text.refine(
  (value) =>
    /^(?:npm:(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[a-z0-9-._~^>=<]+)?|git:(?:https?:\/\/|github\.com\/|gitlab\.com\/)[a-z0-9._/-]+(?:#[a-z0-9._/-]+)?)$/i.test(
      value,
    ) && !value.includes('..'),
  'must be a valid npm: or git: Pi package spec',
)
const installDef = z
  .object({
    source: installSource,
    homepage: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), 'homepage must be https://')
      .optional(),
  })
  .strict()
const source = z.object({ type: z.literal('json'), path: text, itemsPath: z.string().optional(), fields: z.record(z.string()).optional() }).strict()
const interactDefaults = z
  .object({
    title: z.string().optional(),
    question: z.string().optional(),
    options: strings.max(8).optional(),
    cancelLabel: z.string().optional(),
    allowFeedback: z.boolean().optional(),
  })
  .strict()
const schema = z.object({
  schemaVersion: z.literal(1).optional(), kind: z.enum(['plugin', 'desktop']).optional(),
  id: text, tier: z.enum(['native', 'partial', 'headless', 'none']),
  displayName: z.string().optional(), description: z.string().optional(),
  match: z.object({ names: strings.optional(), tools: strings.optional(), commands: strings.optional() }).strict().optional(),
  install: installDef.optional(),
  alwaysVisible: z.boolean().optional(),
  config: z.object({
    configFile: text.optional(), fileKeyMap: z.record(text).optional(), envOverride: z.record(text).optional(), localKeys: strings.optional(), piSettingsKey: text.optional(), fileConstants: z.record(z.unknown()).optional(), customRenderer: text.optional(),
    sections: z.array(z.object({ title: z.string().optional(), fields: z.array(field).optional(), derived: z.array(z.object({ label: text, available: z.string().optional(), detail: z.string().optional() })).optional() }).passthrough()).optional(),
    actions: z.array(z.object({ id: text, type: z.enum(['httpCheck', 'openPath', 'reload']), url: z.string().optional(), method: z.string().optional(), headers: z.record(z.string()).optional(), timeoutMs: z.number().positive().max(60000).optional() }).passthrough()).optional(),
  }).passthrough().optional(),
  toolCard: z.object({ template: z.enum(['default', 'list', 'media', 'tree', 'kv', 'hashline']).optional(), fields: z.record(z.string()).optional(), statusField: z.string().optional(), protocol: text.optional() }).passthrough().optional(),
  interact: z.object({ trigger: z.object({ tool: text.optional(), argsMatch: z.record(z.unknown()).optional() }), schema: z.enum(['questions', 'clarify', 'review']), fields: z.record(z.string()).optional(), defaults: interactDefaults.optional() }).strict().optional(),
  slash: z.record(z.enum(['notify', 'config-page', 'execute', 'open-panel'])).optional(),
  slashPanels: z.record(text).optional(),
  widget: z.object({
    keys: strings.optional(), tools: strings.optional(), placement: z.literal('aboveComposer'), protocol: z.literal('todo-list-v1'), fields: z.record(z.string()).optional(),
    textLines: z.object({ skip: z.array(pattern).optional(), strip: pattern.optional(), status: z.record(z.enum(TODO_STATUSES)).optional(), id: pattern.optional() }).strict().optional(),
  }).passthrough().optional(),
  statusBar: statusBar.optional(),
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
  const localPkg = name.lastIndexOf('/local-packages/')
  if (modules >= 0) {
    const parts = name.slice(modules + 14).split('/')
    name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  } else if (localPkg >= 0) {
    const parts = name.slice(localPkg + 16).split('/').filter(Boolean)
    if (parts.length > 0) name = parts[0].startsWith('@') && parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0]
  } else if (/^(?:\.?\/)?local-packages\//.test(name)) {
    const parts = name.replace(/^(?:\.?\/)?local-packages\//, '').split('/').filter(Boolean)
    if (parts.length > 0) name = parts[0].startsWith('@') && parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0]
  } else if (/^(git:|https?:)|github\.com\//.test(name)) {
    name = name.replace(/\.git(?:@.*)?$/, '').replace(/@[^/]*$/, '').split('/').pop() || name
  }
  return name.replace(/@[^/@]+$/, '').toLowerCase()
}
