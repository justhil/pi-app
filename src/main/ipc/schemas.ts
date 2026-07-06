import { z } from 'zod'

export const shellOpenPathSchema = z.object({
  path: z.string(),
})

export const shellShowItemSchema = z.object({
  path: z.string(),
})

export const workspaceFsListDirSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string().optional(),
})

export const workspaceFsReadTextSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string(),
  maxBytes: z.number().optional(),
})

export const workspaceFsRenameSchema = z.object({
  workspaceRoot: z.string(),
  relativePath: z.string(),
  newName: z.string(),
})

export const sessionExportSchema = z.object({
  format: z.enum(['json', 'markdown', 'html']).optional(),
  sessionFile: z.string().optional(),
})

export const sessionNavigateTreeSchema = z.object({
  targetId: z.string().min(1),
  sessionFile: z.string().optional(),
  summarize: z.boolean().optional(),
  label: z.string().optional(),
})

export const sessionGetMessagesSchema = z.object({
  sessionFile: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
})

export const sessionNewSchema = z.object({
  workspaceId: z.string().min(1),
})

export const sessionDeleteSchema = z.object({
  sessionFile: z.string().min(1),
})

export const sessionPrepareSchema = z.object({
  sessionFile: z.string().min(1),
})

export const workspaceOpenSchema = z.object({
  path: z.string().min(1),
  awaitWorker: z.boolean().optional(),
})

export const workspaceSandboxDeleteSchema = z.object({
  path: z.string().min(1),
})

export const promptTextSchema = z.object({
  text: z.string(),
  sessionFile: z.string().optional(),
})

const CLIPBOARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export const clipboardWriteTempImageSchema = z
  .object({
    data: z.string().min(1),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']),
  })
  .superRefine((req, ctx) => {
    const bytes = Buffer.from(req.data, 'base64')
    if (bytes.length > CLIPBOARD_IMAGE_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image too large', path: ['data'] })
    }
  })

export const piSettingsSetSchema = z.object({
  patch: z.record(z.unknown()),
})

export const shellReadImagePreviewSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

export const reviewMutationSchema = z.object({
  cwd: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        hunkPatches: z.array(z.string()),
      }),
    )
    .optional(),
  message: z.string().optional(),
})

export const sdkInstallSchema = z.object({
  version: z.string().min(1),
})

const settingsValueSchemas: Record<string, z.ZodTypeAny> = {
  theme: z.enum(['light', 'dark', 'system']),
  language: z.enum(['zh', 'en']),
  currentProject: z.string().nullable(),
  recentProjects: z.array(z.string()),
  autoOpenLastProject: z.boolean(),
  autoCheckRegistryUpdates: z.boolean(),
  alertSoundEnabled: z.boolean(),
  alertNotificationEnabled: z.boolean(),
  alertOnExtensionUi: z.boolean(),
  alertOnRunIdle: z.boolean(),
  timelineMaxAutoExpandedTools: z.number().int().min(1).max(50),
  rightPanelPrefs: z.record(z.boolean()),
  rightPanelOrder: z.array(z.string()),
  sessionDisplayNames: z.record(z.string()),
  extensionOverrides: z.record(z.boolean()),
  skillOverrides: z.record(z.boolean()),
  extensionConfigs: z.record(z.record(z.unknown())),
  panelWidths: z
    .object({ sidebar: z.number(), right: z.number() })
    .nullable(),
  windowBounds: z
    .object({ width: z.number(), height: z.number(), x: z.number().optional(), y: z.number().optional() })
    .nullable(),
  asrConfig: z.record(z.unknown()),
}

export const settingsSetSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown(),
  })
  .superRefine((req, ctx) => {
    const schema = settingsValueSchemas[req.key]
    if (!schema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unknown settings key', path: ['key'] })
      return
    }
    const parsed = schema.safeParse(req.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['value', ...issue.path] })
      }
    }
  })