import {
  DEFAULT_UI_CUSTOMIZATION,
  normalizeUiCustomization,
  type UiCustomization,
} from '@shared/ui-customization'

const UI_CUSTOMIZATION_STYLE_ID = 'pi-ui-customization-vars'

function setOrRemoveDataAttr(el: HTMLElement, attr: string, value: string, defaultValue: string): void {
  if (value && value !== defaultValue) {
    el.setAttribute(attr, value)
  } else {
    el.removeAttribute?.(attr)
  }
}

/**
 * Synchronize structured UI customization into <html> data-* attributes and base CSS variables.
 * Placed before #pi-custom-theme and #pi-custom-css so user custom CSS always wins cleanly.
 */
export function applyUiCustomizationToDocument(raw: UiCustomization | unknown): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  const cfg = normalizeUiCustomization(raw)
  const root = document.documentElement
  const d = DEFAULT_UI_CUSTOMIZATION

  setOrRemoveDataAttr(root, 'data-mid-prose-style', cfg.midTurnProseStyle, d.midTurnProseStyle)
  setOrRemoveDataAttr(root, 'data-composer-preset', cfg.composerPreset, d.composerPreset)
  setOrRemoveDataAttr(root, 'data-composer-accessory', cfg.composerAccessoryMode, d.composerAccessoryMode)
  setOrRemoveDataAttr(root, 'data-composer-attach', cfg.composerAttachVisible ? 'visible' : 'hidden', 'visible')
  setOrRemoveDataAttr(root, 'data-composer-tools', cfg.composerToolsMode, d.composerToolsMode)
  setOrRemoveDataAttr(root, 'data-composer-purge', cfg.composerPurgeMode, d.composerPurgeMode)
  setOrRemoveDataAttr(root, 'data-composer-model-strip', cfg.composerModelStripMode, d.composerModelStripMode)
  setOrRemoveDataAttr(root, 'data-composer-metrics', cfg.composerMetricsMode, d.composerMetricsMode)
  setOrRemoveDataAttr(root, 'data-composer-tps', cfg.composerShowTps ? 'visible' : 'hidden', 'visible')
  setOrRemoveDataAttr(root, 'data-composer-voice', cfg.composerVoiceVisible ? 'visible' : 'hidden', 'visible')
  setOrRemoveDataAttr(root, 'data-composer-context-position', cfg.composerContextPosition, d.composerContextPosition)
  setOrRemoveDataAttr(root, 'data-composer-context-style', cfg.composerContextStyle, d.composerContextStyle)
  setOrRemoveDataAttr(root, 'data-composer-context-swapped', cfg.composerContextSwapped ? 'swapped' : 'normal', 'normal')
  setOrRemoveDataAttr(root, 'data-composer-worktree', cfg.composerWorktreeMode, d.composerWorktreeMode)
  setOrRemoveDataAttr(root, 'data-composer-branch', cfg.composerBranchMode, d.composerBranchMode)

  if (!document.head) return
  const colVarLines =
    cfg.chatColumnMax === 0
      ? `  --chat-content-min: 100%;
  --chat-content-ratio: 100%;
  --chat-content-cap: 100%;
  --composer-content-ratio: 100%;
  --composer-content-cap: 100%;`
      : `  --chat-content-cap: ${cfg.chatColumnMax}px;
  --composer-content-cap: ${cfg.chatColumnMax}px;`

  const cssText = `:root {
  --chat-font-size: ${cfg.chatFontSize}px;
  --chat-line-height: ${cfg.chatLineHeight};
  --composer-max-height: ${cfg.composerMaxHeight}px;
${colVarLines}
}`

  const existing = document.getElementById(UI_CUSTOMIZATION_STYLE_ID)
  const style = existing ?? document.createElement('style')
  style.id = UI_CUSTOMIZATION_STYLE_ID
  style.textContent = cssText
  if (!style.isConnected) {
    const anchor =
      document.getElementById('pi-custom-theme') ??
      document.getElementById('pi-custom-css') ??
      null
    if (anchor) document.head.insertBefore(style, anchor)
    else document.head.appendChild(style)
  }
}

/** Spotlight matching [data-pi-slot] elements on the live UI when hovering controls in the customizer. */
export function highlightPiSlot(slotName: string | null): void {
  if (typeof document === 'undefined') return
  for (const prev of document.querySelectorAll<HTMLElement>('[data-pi-slot-highlight]')) {
    prev.removeAttribute('data-pi-slot-highlight')
  }
  if (!slotName) return
  for (const el of document.querySelectorAll<HTMLElement>(`[data-pi-slot="${slotName}"]`)) {
    el.setAttribute('data-pi-slot-highlight', 'true')
  }
}
