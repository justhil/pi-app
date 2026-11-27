import {
  CUSTOM_CSS_OVERRIDE_STYLE_ID,
  CUSTOM_THEME_CSS_CACHE_KEY,
  CUSTOM_THEME_STYLE_ID,
  type CustomTheme,
} from '@shared/custom-theme'
import { isCustomThemeDisabled } from './theme-runtime-state'
import { generateThemeCss } from './generate-theme-css'
import { applyRenderFxForTheme } from './render-fx-engine'

export { CUSTOM_THEME_CSS_CACHE_KEY, CUSTOM_THEME_STYLE_ID } from '@shared/custom-theme'

export function injectCustomTheme(css: string): void {
  const existing = document.getElementById(CUSTOM_THEME_STYLE_ID)
  if (isCustomThemeDisabled()) {
    existing?.remove()
    return
  }
  if (!css) {
    existing?.remove()
    localStorage.removeItem(CUSTOM_THEME_CSS_CACHE_KEY)
    return
  }
  const style = existing ?? document.createElement('style')
  style.id = CUSTOM_THEME_STYLE_ID
  style.textContent = css
  if (!style.isConnected) {
    const customCssStyle = document.getElementById(CUSTOM_CSS_OVERRIDE_STYLE_ID)
    if (customCssStyle) document.head.insertBefore(style, customCssStyle)
    else document.head.appendChild(style)
  }
  localStorage.setItem(CUSTOM_THEME_CSS_CACHE_KEY, css)
}

export function applyCustomTheme(theme: CustomTheme): void {
  injectCustomTheme(generateThemeCss(theme))
  applyRenderFxForTheme(theme)
}
