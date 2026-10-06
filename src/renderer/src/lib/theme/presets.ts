import type { ThemeVariant, ThemeVariantKey } from '@shared/custom-theme'

export type ThemePreset = {
  id: string
  /** i18n key under settings:appearance.presets */
  labelKey: string
  light?: ThemeVariant
  dark?: ThemeVariant
}

const base = { fontUi: null, fontCode: null } as const

/**
 * Built-in themes. `default` has no variants: it means "no custom theme" (globals.css as shipped).
 * Each preset's `preset` id is kept on the saved variant until a field is edited.
 */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'default', labelKey: 'default' },
  {
    id: 'claude',
    labelKey: 'claude',
    // Warm ivory paper, terracotta accent, serif headings and prose; soft borders, rounder corners.
    light: {
      ...base,
      preset: 'claude',
      accent: '#c96442',
      surface: '#faf9f5',
      ink: '#141413',
      contrast: 40,
      translucentSidebar: false,
      diffAdded: '#2f7d4f',
      diffRemoved: '#b5452e',
      colors: { sidebar: '#f3f1ea', userBubble: '#f0eee6', codeBg: '#f5f4ee', border: '#e3e0d5' },
      fontDisplay: 'serif',
      proseFont: 'display',
      chatFontSize: 16,
      chatLineHeight: 1.7,
      radius: 10,
      shadow: 30,
    },
    dark: {
      ...base,
      preset: 'claude',
      accent: '#d97757',
      surface: '#262624',
      ink: '#f5f4ef',
      contrast: 55,
      translucentSidebar: false,
      diffAdded: '#6fbf8a',
      diffRemoved: '#e0806a',
      colors: { sidebar: '#1f1e1d', userBubble: '#30302e', codeBg: '#1f1e1d', border: '#3b3a36' },
      fontDisplay: 'serif',
      proseFont: 'display',
      chatFontSize: 16,
      chatLineHeight: 1.7,
      radius: 10,
      shadow: 40,
    },
  },
  {
    id: 'vscode-plus',
    labelKey: 'vscodePlus',
    light: {
      ...base,
      preset: 'vscode-plus',
      accent: '#007acc',
      surface: '#ffffff',
      ink: '#000000',
      contrast: 45,
      translucentSidebar: true,
      diffAdded: '#008000',
      diffRemoved: '#ee0000',
    },
  },
  {
    id: 'codex-dark',
    labelKey: 'codexDark',
    dark: {
      ...base,
      preset: 'codex-dark',
      accent: '#339cff',
      surface: '#181818',
      ink: '#ffffff',
      contrast: 60,
      translucentSidebar: false,
    },
  },
]

export function presetVariant(id: string, variant: ThemeVariantKey): ThemeVariant | undefined {
  const v = THEME_PRESETS.find((p) => p.id === id)?.[variant]
  return v ? structuredClone(v) : undefined
}

export function presetsFor(variant: ThemeVariantKey): ThemePreset[] {
  return THEME_PRESETS.filter((p) => p.id === 'default' || p[variant])
}
