import { z } from 'zod'
import { normalizeFontName } from '../../../packages/shared/custom-theme.ts'
import { ICON_THEMES } from '../../../packages/shared/icon-theme.ts'

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

export const workspaceFsSearchSchema = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().max(512),
  maxResults: z.number().int().min(1).max(20).optional(),
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
  /** After navigateTree: force branch tip so history matches rewound leaf */
  leafId: z.string().nullable().optional(),
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

const hexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const fontNameSchema = z
  .string()
  .max(80)
  .refine((value) => normalizeFontName(value) === value, 'invalid local font name')

const themeVariantSchema = z
  .object({
    preset: z.string().nullable(),
    accent: hexColorSchema,
    surface: hexColorSchema,
    ink: hexColorSchema,
    contrast: z.number().min(0).max(100),
    fontUi: fontNameSchema.nullable(),
    fontCode: fontNameSchema.nullable(),
    translucentSidebar: z.boolean(),
    diffAdded: hexColorSchema.optional(),
    diffRemoved: hexColorSchema.optional(),
  })
  .strict()

const settingsValueSchemas: Record<string, z.ZodTypeAny> = {
  theme: z.enum(['light', 'dark', 'system']),
  iconTheme: z.enum(ICON_THEMES),
  customTheme: z
    .object({ light: themeVariantSchema.optional(), dark: themeVariantSchema.optional() })
    .strict()
    .nullable(),
  customCssOverride: z.object({ enabled: z.boolean(), css: z.string() }).strict(),
  language: z.enum(['zh', 'en']),
  currentProject: z.string().nullable(),
  recentProjects: z.array(z.string()),
  autoOpenLastProject: z.boolean(),
  autoCheckRegistryUpdates: z.boolean(),
  ignoredUpdateVersion: z.string(),
  alertSoundEnabled: z.boolean(),
  alertNotificationEnabled: z.boolean(),
  alertOnExtensionUi: z.boolean(),
  alertOnRunIdle: z.boolean(),
  alertOnBackgroundRunIdle: z.boolean(),
  maxSessionWorkers: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sessionWorkerIdleTimeoutMinutes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  timelineMaxAutoExpandedTools: z.number().int().min(0).max(50),
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