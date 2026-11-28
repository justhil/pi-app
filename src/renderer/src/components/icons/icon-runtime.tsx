import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_ICON_THEME, normalizeIconTheme, type IconTheme } from '@shared/icon-theme'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { AppIconName } from './icon-names'
import type { AppIconComponent, AppIconProps, ThemeIconMap } from './types'
import { phosphorIcons } from './themes/phosphor'

type LoadedIconThemes = Partial<Record<IconTheme, ThemeIconMap>>

interface IconThemeState {
  iconTheme: IconTheme
  /** Glyph sets in memory. The default set ships with the app shell; the others load on demand. */
  loadedThemes: LoadedIconThemes
  setIconTheme: (iconTheme: IconTheme) => void
}

export const useIconThemeStore = create<IconThemeState>((set) => ({
  iconTheme: DEFAULT_ICON_THEME,
  loadedThemes: { phosphor: phosphorIcons },
  setIconTheme: (iconTheme) => set({ iconTheme }),
}))

/** Only the theme in use is downloaded and parsed: each set is its own chunk. */
const THEME_LOADERS: Record<Exclude<IconTheme, 'phosphor'>, () => Promise<ThemeIconMap>> = {
  lucide: () => import('./themes/lucide').then((m) => m.lucideIcons),
  fluent: () => import('./themes/fluent').then((m) => m.fluentIcons),
  hugeicons: () => import('./themes/hugeicons').then((m) => m.hugeiconsIcons),
  iconoir: () => import('./themes/iconoir').then((m) => m.iconoirIcons),
}

const themeLoads = new Map<IconTheme, Promise<void>>()

/** Loads a theme's glyph set once; icons of that theme show the default glyphs until it lands. */
export function loadIconTheme(theme: IconTheme): Promise<void> {
  if (useIconThemeStore.getState().loadedThemes[theme]) return Promise.resolve()
  const pending = themeLoads.get(theme)
  if (pending) return pending
  const load = THEME_LOADERS[theme as keyof typeof THEME_LOADERS]()
    .then((icons) => {
      useIconThemeStore.setState((state) => ({ loadedThemes: { ...state.loadedThemes, [theme]: icons } }))
    })
    .catch((error: unknown) => {
      // A failed load may be retried by the next caller; the default glyphs stay on screen.
      themeLoads.delete(theme)
      console.warn(`[icons] Unable to load the ${theme} icon theme`, error)
    })
  themeLoads.set(theme, load)
  return load
}

/** Selects the theme now; the returned promise settles once its glyphs are on screen. */
export function applyIconTheme(theme: IconTheme): Promise<void> {
  useIconThemeStore.getState().setIconTheme(theme)
  return loadIconTheme(theme)
}

export async function hydrateIconThemeFromSettings(): Promise<IconTheme> {
  const response = await ipcClient
    .invoke('settings.get', { key: 'iconTheme' })
    .catch(() => ({ settings: {} }))
  const theme = normalizeIconTheme(response?.settings?.iconTheme)
  await applyIconTheme(theme)
  return theme
}

function glyphProps(theme: IconTheme, name: AppIconName, props: AppIconProps): AppIconProps {
  const next: AppIconProps & Record<`data-${string}`, string> = {
    ...props,
    'data-icon-theme': theme,
  }
  const filledSquare = name === 'square' && (props.strokeWidth === 0 || props.className?.includes('fill-current'))
  if (filledSquare) {
    next['data-icon-filled'] = 'true'
    if (theme === 'phosphor') (next as AppIconProps & { weight?: string }).weight = 'fill'
    if (theme === 'hugeicons' || theme === 'iconoir') {
      next.fill = 'currentColor'
      next.strokeWidth = 0
    }
  }
  if (theme === 'phosphor' && !('weight' in next)) {
    ;(next as AppIconProps & { weight?: string }).weight = 'regular'
  }
  if ((theme === 'hugeicons' || theme === 'iconoir') && props.strokeWidth !== 0) {
    next.strokeWidth = props.strokeWidth ?? (theme === 'iconoir' ? 1.75 : 1.5)
  }
  if (theme === 'fluent') {
    delete next.strokeWidth
  }
  return next
}

export interface ThemedIconProps extends AppIconProps {
  name: AppIconName
  theme: IconTheme
}

export function ThemedIcon({ name, theme, ...props }: ThemedIconProps) {
  const icons = useIconThemeStore((state) => state.loadedThemes[theme])
  useEffect(() => {
    if (!icons) void loadIconTheme(theme)
  }, [icons, theme])
  // Until the requested set has loaded, draw the default theme's glyph (never an empty slot).
  const shown = icons ? theme : DEFAULT_ICON_THEME
  const Glyph = (icons ?? phosphorIcons)[name]
  return <Glyph {...glyphProps(shown, name, props)} />
}

export function createAppIcon(name: AppIconName, displayName: string): AppIconComponent {
  function AppIcon(props: AppIconProps) {
    const theme = useIconThemeStore((state) => state.iconTheme)
    return <ThemedIcon {...props} theme={theme} name={name} />
  }
  AppIcon.displayName = displayName
  return AppIcon
}

export function resolveAppIcon(name: AppIconName): AppIconComponent {
  return createAppIcon(name, name)
}
