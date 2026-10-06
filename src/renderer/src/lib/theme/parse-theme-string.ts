import { z } from 'zod'
import {
  DEFAULT_THEME_CONTRAST,
  normalizeFontName,
  normalizeThemeExtras,
  type ThemeVariant,
  type ThemeVariantKey,
} from '@shared/custom-theme'

export type ThemeStringSourcePrefix = 'pi-theme-v1' | 'codex-theme-v1'

export type ParsedThemeString = {
  targetVariant: ThemeVariantKey
  themeVariant: ThemeVariant
  ignoredFieldCount: number
  ignoredFieldNames: string[]
  sourcePrefix: ThemeStringSourcePrefix
}

const PREFIXES = ['pi-theme-v1', 'codex-theme-v1'] as const
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const themePayloadSchema = z
  .object({
    preset: z.unknown().optional(),
    accent: z.unknown(),
    surface: z.unknown(),
    ink: z.unknown(),
    contrast: z.unknown().optional(),
    fonts: z.unknown().optional(),
    opaqueWindows: z.unknown().optional(),
    semanticColors: z.unknown().optional(),
    variant: z.unknown().optional(),
  })
  .passthrough()

const envelopeSchema = z
  .object({
    codeThemeId: z.unknown().optional(),
    theme: themePayloadSchema,
  })
  .passthrough()

function parsePrefix(input: string): { sourcePrefix: ThemeStringSourcePrefix; json: string } {
  for (const prefix of PREFIXES) {
    const marker = `${prefix}:`
    if (input.startsWith(marker)) return { sourcePrefix: prefix, json: input.slice(marker.length) }
  }
  throw new Error('Theme string must start with pi-theme-v1: or codex-theme-v1:')
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error('Theme string contains invalid JSON')
  }
}

function formatPath(path: string): string {
  return path.startsWith('theme.') ? path : `theme.${path}`
}

function normalizeColor(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || !COLOR_RE.test(raw.trim())) {
    throw new Error(`${formatPath(path)} must be #rgb, #rrggbb, or #rrggbbaa`)
  }
  const color = raw.trim().toLowerCase()
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return color.slice(0, 7)
}

function normalizeVariant(raw: unknown, fallbackVariant?: ThemeVariantKey): ThemeVariantKey {
  if (raw === 'light' || raw === 'dark') return raw
  if (raw === undefined && fallbackVariant) return fallbackVariant
  if (raw === undefined) throw new Error('theme.variant is required when fallbackVariant is not provided')
  throw new Error('theme.variant must be light or dark')
}

function normalizeContrast(raw: unknown, variant: ThemeVariantKey): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_THEME_CONTRAST[variant]
  return Math.min(100, Math.max(0, raw))
}

function normalizePreset(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== 'string') throw new Error('theme.preset must be a string or null')
  return raw
}

function normalizeOptionalObject(raw: unknown, path: string): Record<string, unknown> {
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${formatPath(path)} must be an object`)
  }
  return raw as Record<string, unknown>
}

function normalizeFont(raw: unknown, path: string): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') throw new Error(`${formatPath(path)} must be a string or null`)
  return normalizeFontName(raw)
}

function normalizeOpaqueWindows(raw: unknown): boolean {
  if (raw === undefined) return false
  if (typeof raw !== 'boolean') throw new Error('theme.opaqueWindows must be a boolean')
  return raw
}

function ownUnknownFields(value: Record<string, unknown>, supported: readonly string[], prefix: string): string[] {
  const allowed = new Set(supported)
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${prefix}${key}`)
}

export function parseThemeString(input: string, fallbackVariant?: ThemeVariantKey): ParsedThemeString {
  const trimmed = input.trim()
  const { sourcePrefix, json } = parsePrefix(trimmed)
  const parsedJson = parseJson(json)
  const parsedEnvelope = envelopeSchema.safeParse(parsedJson)
  if (!parsedEnvelope.success) {
    const issue = parsedEnvelope.error.issues[0]
    const path = issue.path.length ? issue.path.join('.') : 'theme payload'
    throw new Error(`${path}: ${issue.message}`)
  }

  const envelope = parsedEnvelope.data as Record<string, unknown> & {
    theme: Record<string, unknown>
  }
  const theme = envelope.theme
  const targetVariant = normalizeVariant(theme.variant, fallbackVariant)
  const fonts = normalizeOptionalObject(theme.fonts, 'fonts')
  const semanticColors = normalizeOptionalObject(theme.semanticColors, 'semanticColors')
  const opaqueWindows = normalizeOpaqueWindows(theme.opaqueWindows)

  const diffAdded =
    semanticColors.diffAdded === undefined
      ? undefined
      : normalizeColor(semanticColors.diffAdded, 'semanticColors.diffAdded')
  const diffRemoved =
    semanticColors.diffRemoved === undefined
      ? undefined
      : normalizeColor(semanticColors.diffRemoved, 'semanticColors.diffRemoved')

  const ignoredFieldNames = [
    ...ownUnknownFields(envelope, ['theme', 'codeThemeId'], ''),
    ...ownUnknownFields(
      theme,
      [
        'preset',
        'accent',
        'surface',
        'ink',
        'contrast',
        'fonts',
        'opaqueWindows',
        'semanticColors',
        'variant',
        'pi',
      ],
      'theme.',
    ),
    ...ownUnknownFields(fonts, ['ui', 'code'], 'theme.fonts.'),
    ...ownUnknownFields(semanticColors, ['diffAdded', 'diffRemoved', 'skill'], 'theme.semanticColors.'),
  ]
  if (Object.prototype.hasOwnProperty.call(envelope, 'codeThemeId')) ignoredFieldNames.push('codeThemeId')
  if (Object.prototype.hasOwnProperty.call(semanticColors, 'skill')) {
    ignoredFieldNames.push('theme.semanticColors.skill')
  }

  const themeVariant: ThemeVariant = {
    preset: normalizePreset(theme.preset),
    accent: normalizeColor(theme.accent, 'accent'),
    surface: normalizeColor(theme.surface, 'surface'),
    ink: normalizeColor(theme.ink, 'ink'),
    contrast: normalizeContrast(theme.contrast, targetVariant),
    fontUi: normalizeFont(fonts.ui, 'fonts.ui'),
    fontCode: normalizeFont(fonts.code, 'fonts.code'),
    translucentSidebar: !opaqueWindows,
    ...(diffAdded ? { diffAdded } : {}),
    ...(diffRemoved ? { diffRemoved } : {}),
    // pi-only fields (colors, typography, shape); codex ignores the key.
    ...(theme.pi && typeof theme.pi === 'object' ? normalizeThemeExtras(theme.pi as Record<string, unknown>) : {}),
  }

  const uniqueIgnoredFieldNames = [...new Set(ignoredFieldNames)].sort()
  return {
    targetVariant,
    themeVariant,
    ignoredFieldCount: uniqueIgnoredFieldNames.length,
    ignoredFieldNames: uniqueIgnoredFieldNames,
    sourcePrefix,
  }
}

function extrasOf(v: ThemeVariant): Partial<ThemeVariant> {
  return normalizeThemeExtras(v as unknown as Record<string, unknown>)
}

export function exportThemeString(themeVariant: ThemeVariant, variant: ThemeVariantKey): string {
  const normalized = {
    theme: {
      preset: themeVariant.preset,
      accent: normalizeColor(themeVariant.accent, 'accent'),
      contrast: Math.min(100, Math.max(0, themeVariant.contrast)),
      fonts: {
        code: normalizeFont(themeVariant.fontCode, 'fonts.code'),
        ui: normalizeFont(themeVariant.fontUi, 'fonts.ui'),
      },
      ink: normalizeColor(themeVariant.ink, 'ink'),
      opaqueWindows: !themeVariant.translucentSidebar,
      semanticColors: {
        ...(themeVariant.diffAdded
          ? { diffAdded: normalizeColor(themeVariant.diffAdded, 'semanticColors.diffAdded') }
          : {}),
        ...(themeVariant.diffRemoved
          ? { diffRemoved: normalizeColor(themeVariant.diffRemoved, 'semanticColors.diffRemoved') }
          : {}),
      },
      variant,
      surface: normalizeColor(themeVariant.surface, 'surface'),
      ...(Object.keys(extrasOf(themeVariant)).length ? { pi: extrasOf(themeVariant) } : {}),
    },
  }
  return `pi-theme-v1:${JSON.stringify(normalized)}`
}
