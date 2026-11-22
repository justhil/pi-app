/**
 * Workbench UI customization schema shared across Main persistence, Settings page,
 * and the floating Live Customize Studio.
 */

export const MID_TURN_PROSE_STYLES = ['match', 'muted', 'rail'] as const
export type MidTurnProseStyle = (typeof MID_TURN_PROSE_STYLES)[number]

export const COMPOSER_PRESETS = ['paper', 'minimal', 'zen', 'split'] as const
export type ComposerPreset = (typeof COMPOSER_PRESETS)[number]

export const COMPOSER_ACCESSORY_MODES = ['all', 'todo-only', 'activity-only', 'hidden'] as const
export type ComposerAccessoryMode = (typeof COMPOSER_ACCESSORY_MODES)[number]

export const COMPOSER_TOOLS_MODES = ['always', 'active-only', 'hidden'] as const
export type ComposerToolsMode = (typeof COMPOSER_TOOLS_MODES)[number]

export const COMPOSER_PURGE_MODES = ['full', 'icon', 'active-only', 'hidden'] as const
export type ComposerPurgeMode = (typeof COMPOSER_PURGE_MODES)[number]

export const COMPOSER_MODEL_STRIP_MODES = ['full', 'compact', 'model-only', 'hidden'] as const
export type ComposerModelStripMode = (typeof COMPOSER_MODEL_STRIP_MODES)[number]

export const COMPOSER_METRICS_MODES = ['ring', 'percent', 'ring-percent', 'pill', 'hidden'] as const
export type ComposerMetricsMode = (typeof COMPOSER_METRICS_MODES)[number]

export const COMPOSER_CONTEXT_POSITIONS = ['below', 'above', 'statusbar', 'hidden'] as const
export type ComposerContextPosition = (typeof COMPOSER_CONTEXT_POSITIONS)[number]

export const COMPOSER_CONTEXT_STYLES = ['minimal', 'pill', 'tray'] as const
export type ComposerContextStyle = (typeof COMPOSER_CONTEXT_STYLES)[number]

export const COMPOSER_WORKTREE_MODES = ['full', 'compact', 'icon', 'hidden'] as const
export type ComposerWorktreeMode = (typeof COMPOSER_WORKTREE_MODES)[number]

export const COMPOSER_BRANCH_MODES = ['full', 'branch-only', 'compact', 'hidden'] as const
export type ComposerBranchMode = (typeof COMPOSER_BRANCH_MODES)[number]

export const COMPOSER_TOOLBAR_ITEMS = [
  'attach',
  'tools',
  'purge',
  'spacer',
  'model',
  'metrics',
] as const
export type ComposerToolbarItemId = (typeof COMPOSER_TOOLBAR_ITEMS)[number]

export interface UiCustomization {
  /** Mid-turn transitional prose style between tool runs. */
  midTurnProseStyle: MidTurnProseStyle
  /** Base chat prose font size in px (12.5 - 17, step 0.5). */
  chatFontSize: number
  /** Base chat prose line-height (1.45 - 1.9). */
  chatLineHeight: number
  /** Max reading & composer column width in px (640 - 1280), or 0 for 100% full width. */
  chatColumnMax: number
  /** Overall Composer shell aesthetic preset. */
  composerPreset: ComposerPreset
  /** Max height of the RichInput editor before scrolling (80 - 320px). */
  composerMaxHeight: number
  /** Accessory bar above composer shell (Todo drawer & live activity pill). */
  composerAccessoryMode: ComposerAccessoryMode
  /** Ordered toolbar items; 'spacer' represents the flexible flex-1 split point. */
  composerToolbarOrder: ComposerToolbarItemId[]
  /** Show '+' add file button. */
  composerAttachVisible: boolean
  /** Tools & cache warming button visibility mode. */
  composerToolsMode: ComposerToolsMode
  /** Persona / purge toggle button style & visibility mode. */
  composerPurgeMode: ComposerPurgeMode
  /** Model & thinking strip display mode. */
  composerModelStripMode: ComposerModelStripMode
  /** Context window usage indicator style. */
  composerMetricsMode: ComposerMetricsMode
  /** Show live tokens/sec readout while running. */
  composerShowTps: boolean
  /** Show voice microphone button when input is empty. */
  composerVoiceVisible: boolean
  /** Placement of the Worktree + Git branch context strip. */
  composerContextPosition: ComposerContextPosition
  /** Visual surface style of the context strip controls. */
  composerContextStyle: ComposerContextStyle
  /** Swap left/right order (default false = Worktree left, Branch right). */
  composerContextSwapped: boolean
  /** Display mode of the Worktree/environment selector. */
  composerWorktreeMode: ComposerWorktreeMode
  /** Display mode of the Git branch & PR badge area. */
  composerBranchMode: ComposerBranchMode
}

export const DEFAULT_UI_CUSTOMIZATION: UiCustomization = {
  midTurnProseStyle: 'match',
  chatFontSize: 14.5,
  chatLineHeight: 1.68,
  chatColumnMax: 800,
  composerPreset: 'paper',
  composerMaxHeight: 112,
  composerAccessoryMode: 'all',
  composerToolbarOrder: [...COMPOSER_TOOLBAR_ITEMS],
  composerAttachVisible: true,
  composerToolsMode: 'always',
  composerPurgeMode: 'full',
  composerModelStripMode: 'full',
  composerMetricsMode: 'ring',
  composerShowTps: true,
  composerVoiceVisible: true,
  composerContextPosition: 'below',
  composerContextStyle: 'minimal',
  composerContextSwapped: false,
  composerWorktreeMode: 'full',
  composerBranchMode: 'full',
}

function pickEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

function clampNum(raw: unknown, min: number, max: number, step: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  const clamped = Math.min(max, Math.max(min, n))
  const stepped = Math.round(clamped / step) * step
  return Math.round(stepped * 100) / 100
}

export function normalizeComposerToolbarOrder(raw: unknown): ComposerToolbarItemId[] {
  if (!Array.isArray(raw)) return [...COMPOSER_TOOLBAR_ITEMS]
  const allowed = new Set<string>(COMPOSER_TOOLBAR_ITEMS)
  const seen = new Set<ComposerToolbarItemId>()
  const out: ComposerToolbarItemId[] = []
  for (const item of raw) {
    if (typeof item === 'string' && allowed.has(item) && !seen.has(item as ComposerToolbarItemId)) {
      const typed = item as ComposerToolbarItemId
      seen.add(typed)
      out.push(typed)
    }
  }
  for (const fallbackItem of COMPOSER_TOOLBAR_ITEMS) {
    if (!seen.has(fallbackItem)) out.push(fallbackItem)
  }
  return out
}

export function normalizeUiCustomization(raw: unknown): UiCustomization {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_UI_CUSTOMIZATION, composerToolbarOrder: [...COMPOSER_TOOLBAR_ITEMS] }
  }
  const src = raw as Record<string, unknown>
  const chatColumnMax =
    src.chatColumnMax === 0 || src.chatColumnMax === '0'
      ? 0
      : clampNum(src.chatColumnMax, 640, 1280, 20, DEFAULT_UI_CUSTOMIZATION.chatColumnMax)

  return {
    midTurnProseStyle: pickEnum(src.midTurnProseStyle, MID_TURN_PROSE_STYLES, DEFAULT_UI_CUSTOMIZATION.midTurnProseStyle),
    chatFontSize: clampNum(src.chatFontSize, 12.5, 17, 0.5, DEFAULT_UI_CUSTOMIZATION.chatFontSize),
    chatLineHeight: clampNum(src.chatLineHeight, 1.45, 1.9, 0.02, DEFAULT_UI_CUSTOMIZATION.chatLineHeight),
    chatColumnMax,
    composerPreset: pickEnum(src.composerPreset, COMPOSER_PRESETS, DEFAULT_UI_CUSTOMIZATION.composerPreset),
    composerMaxHeight: clampNum(src.composerMaxHeight, 80, 320, 8, DEFAULT_UI_CUSTOMIZATION.composerMaxHeight),
    composerAccessoryMode: pickEnum(
      src.composerAccessoryMode,
      COMPOSER_ACCESSORY_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerAccessoryMode,
    ),
    composerToolbarOrder: normalizeComposerToolbarOrder(src.composerToolbarOrder),
    composerAttachVisible:
      typeof src.composerAttachVisible === 'boolean'
        ? src.composerAttachVisible
        : DEFAULT_UI_CUSTOMIZATION.composerAttachVisible,
    composerToolsMode: pickEnum(
      src.composerToolsMode,
      COMPOSER_TOOLS_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerToolsMode,
    ),
    composerPurgeMode: pickEnum(
      src.composerPurgeMode,
      COMPOSER_PURGE_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerPurgeMode,
    ),
    composerModelStripMode: pickEnum(
      src.composerModelStripMode,
      COMPOSER_MODEL_STRIP_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerModelStripMode,
    ),
    composerMetricsMode: pickEnum(
      src.composerMetricsMode,
      COMPOSER_METRICS_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerMetricsMode,
    ),
    composerShowTps:
      typeof src.composerShowTps === 'boolean' ? src.composerShowTps : DEFAULT_UI_CUSTOMIZATION.composerShowTps,
    composerVoiceVisible:
      typeof src.composerVoiceVisible === 'boolean'
        ? src.composerVoiceVisible
        : DEFAULT_UI_CUSTOMIZATION.composerVoiceVisible,
    composerContextPosition: pickEnum(
      src.composerContextPosition,
      COMPOSER_CONTEXT_POSITIONS,
      DEFAULT_UI_CUSTOMIZATION.composerContextPosition,
    ),
    composerContextStyle: pickEnum(
      src.composerContextStyle,
      COMPOSER_CONTEXT_STYLES,
      DEFAULT_UI_CUSTOMIZATION.composerContextStyle,
    ),
    composerContextSwapped:
      typeof src.composerContextSwapped === 'boolean'
        ? src.composerContextSwapped
        : DEFAULT_UI_CUSTOMIZATION.composerContextSwapped,
    composerWorktreeMode: pickEnum(
      src.composerWorktreeMode,
      COMPOSER_WORKTREE_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerWorktreeMode,
    ),
    composerBranchMode: pickEnum(
      src.composerBranchMode,
      COMPOSER_BRANCH_MODES,
      DEFAULT_UI_CUSTOMIZATION.composerBranchMode,
    ),
  }
}

export function isDefaultUiCustomization(value: UiCustomization): boolean {
  const d = DEFAULT_UI_CUSTOMIZATION
  return (
    value.midTurnProseStyle === d.midTurnProseStyle &&
    value.chatFontSize === d.chatFontSize &&
    value.chatLineHeight === d.chatLineHeight &&
    value.chatColumnMax === d.chatColumnMax &&
    value.composerPreset === d.composerPreset &&
    value.composerMaxHeight === d.composerMaxHeight &&
    value.composerAccessoryMode === d.composerAccessoryMode &&
    value.composerAttachVisible === d.composerAttachVisible &&
    value.composerToolsMode === d.composerToolsMode &&
    value.composerPurgeMode === d.composerPurgeMode &&
    value.composerModelStripMode === d.composerModelStripMode &&
    value.composerMetricsMode === d.composerMetricsMode &&
    value.composerShowTps === d.composerShowTps &&
    value.composerVoiceVisible === d.composerVoiceVisible &&
    value.composerContextPosition === d.composerContextPosition &&
    value.composerContextStyle === d.composerContextStyle &&
    value.composerContextSwapped === d.composerContextSwapped &&
    value.composerWorktreeMode === d.composerWorktreeMode &&
    value.composerBranchMode === d.composerBranchMode &&
    value.composerToolbarOrder.join(',') === d.composerToolbarOrder.join(',')
  )
}

export type PiSlotCategory = 'composer' | 'timeline' | 'shell'

export interface PiSlotDescriptor {
  slot: string
  category: PiSlotCategory
  labelKey: string
  sampleCss: string
}

export const PI_UI_SLOTS: readonly PiSlotDescriptor[] = [
  { slot: 'composer-dock', category: 'composer', labelKey: 'composerDock', sampleCss: '[data-pi-slot="composer-dock"] {\n  padding-bottom: 12px;\n}' },
  { slot: 'composer-accessory', category: 'composer', labelKey: 'composerAccessory', sampleCss: '[data-pi-slot="composer-accessory"] {\n  opacity: 0.9;\n}' },
  { slot: 'composer-shell', category: 'composer', labelKey: 'composerShell', sampleCss: '[data-pi-slot="composer-shell"] {\n  --composer-shell-radius: 10px;\n}' },
  { slot: 'composer-input', category: 'composer', labelKey: 'composerInput', sampleCss: '[data-pi-slot="composer-input"] {\n  font-size: 14.5px;\n  min-height: 44px;\n}' },
  { slot: 'composer-toolbar', category: 'composer', labelKey: 'composerToolbar', sampleCss: '[data-pi-slot="composer-toolbar"] {\n  gap: 6px;\n}' },
  { slot: 'composer-attach-btn', category: 'composer', labelKey: 'composerAttachBtn', sampleCss: '[data-pi-slot="composer-attach-btn"] {\n  opacity: 0.7;\n}' },
  { slot: 'composer-tools-btn', category: 'composer', labelKey: 'composerToolsBtn', sampleCss: '[data-pi-slot="composer-tools-btn"] {\n  border-radius: 6px;\n}' },
  { slot: 'composer-purge-btn', category: 'composer', labelKey: 'composerPurgeBtn', sampleCss: '[data-pi-slot="composer-purge-btn"] {\n  font-size: 11.5px;\n}' },
  { slot: 'composer-model-strip', category: 'composer', labelKey: 'composerModelStrip', sampleCss: '[data-pi-slot="composer-model-strip"] {\n  gap: 4px;\n}' },
  { slot: 'composer-model-chip', category: 'composer', labelKey: 'composerModelChip', sampleCss: '[data-pi-slot="composer-model-chip"] {\n  font-weight: 500;\n}' },
  { slot: 'composer-thinking-chip', category: 'composer', labelKey: 'composerThinkingChip', sampleCss: '[data-pi-slot="composer-thinking-chip"] {\n  opacity: 0.85;\n}' },
  { slot: 'composer-metrics', category: 'composer', labelKey: 'composerMetrics', sampleCss: '[data-pi-slot="composer-metrics"] {\n  font-size: 11px;\n}' },
  { slot: 'composer-send-btn', category: 'composer', labelKey: 'composerSendBtn', sampleCss: '[data-pi-slot="composer-send-btn"] {\n  border-radius: 999px;\n}' },
  { slot: 'composer-context-strip', category: 'composer', labelKey: 'composerContextStrip', sampleCss: '[data-pi-slot="composer-context-strip"] {\n  padding-inline: 8px;\n  opacity: 0.9;\n}' },
  { slot: 'composer-worktree-btn', category: 'composer', labelKey: 'composerWorktreeBtn', sampleCss: '[data-pi-slot="composer-worktree-btn"] {\n  font-weight: 500;\n}' },
  { slot: 'composer-branch-btn', category: 'composer', labelKey: 'composerBranchBtn', sampleCss: '[data-pi-slot="composer-branch-btn"] {\n  font-family: var(--font-mono);\n}' },
  { slot: 'timeline-viewport', category: 'timeline', labelKey: 'timelineViewport', sampleCss: '[data-pi-slot="timeline-viewport"] {\n  background: var(--chat-bg);\n}' },
  { slot: 'timeline-column', category: 'timeline', labelKey: 'timelineColumn', sampleCss: '[data-pi-slot="timeline-column"] {\n  padding-inline: 24px;\n}' },
  { slot: 'timeline-turn', category: 'timeline', labelKey: 'timelineTurn', sampleCss: '[data-pi-slot="timeline-turn"] + [data-pi-slot="timeline-turn"] {\n  margin-top: 24px;\n}' },
  { slot: 'timeline-user-bubble', category: 'timeline', labelKey: 'timelineUserBubble', sampleCss: '[data-pi-slot="timeline-user-bubble"] {\n  border-radius: 10px;\n}' },
  { slot: 'timeline-prose-row', category: 'timeline', labelKey: 'timelineProseRow', sampleCss: '[data-pi-slot="timeline-prose-row"] {\n  line-height: 1.72;\n}' },
  { slot: 'timeline-mid-prose', category: 'timeline', labelKey: 'timelineMidProse', sampleCss: '[data-pi-slot="timeline-mid-prose"] {\n  opacity: 0.85;\n}' },
  { slot: 'timeline-thinking', category: 'timeline', labelKey: 'timelineThinking', sampleCss: '[data-pi-slot="timeline-thinking"] {\n  font-size: 12px;\n}' },
  { slot: 'timeline-tool-group', category: 'timeline', labelKey: 'timelineToolGroup', sampleCss: '[data-pi-slot="timeline-tool-group"] {\n  opacity: 0.9;\n}' },
  { slot: 'timeline-code-block', category: 'timeline', labelKey: 'timelineCodeBlock', sampleCss: '[data-pi-slot="timeline-code-block"] {\n  border-radius: 8px;\n}' },
  { slot: 'shell-sidebar', category: 'shell', labelKey: 'shellSidebar', sampleCss: '[data-pi-slot="shell-sidebar"] {\n  font-size: 13px;\n}' },
  { slot: 'shell-right-panel', category: 'shell', labelKey: 'shellRightPanel', sampleCss: '[data-pi-slot="shell-right-panel"] {\n  background: var(--bg-base);\n}' },
  { slot: 'shell-status-bar', category: 'shell', labelKey: 'shellStatusBar', sampleCss: '[data-pi-slot="shell-status-bar"] {\n  opacity: 0.9;\n}' },
] as const

export interface CssRecipeDescriptor {
  id: string
  labelKey: string
  css: string
}

export const PI_CSS_RECIPES: readonly CssRecipeDescriptor[] = [
  {
    id: 'hover-toolbar',
    labelKey: 'hoverToolbar',
    css: `/* Auto-reveal secondary Composer buttons on hover/focus */
[data-pi-slot="composer-shell"]:not(.composer-shell-focused):not(:hover) [data-pi-slot="composer-toolbar"] > :not([data-pi-slot="composer-send-group"]) {
  opacity: 0.25;
  transition: opacity 160ms ease;
}`,
  },
  {
    id: 'pill-send',
    labelKey: 'pillSend',
    css: `/* Circular send & voice buttons */
[data-pi-slot="composer-send-btn"],
[data-pi-slot="composer-voice-btn"],
[data-pi-slot="composer-stop-btn"] {
  border-radius: 999px !important;
}`,
  },
  {
    id: 'wide-code',
    labelKey: 'wideCode',
    css: `/* Slightly crisp high-contrast code surface */
[data-pi-slot="timeline-code-block"] {
  border-color: color-mix(in srgb, var(--border-base) 85%, transparent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}`,
  },
  {
    id: 'editorial-headings',
    labelKey: 'editorialHeadings',
    css: `/* Subtle bottom divider under H2 sections in chat */
.prose-chat h2 {
  padding-bottom: 0.28em;
  border-bottom: 1px solid color-mix(in srgb, var(--border-base) 55%, transparent);
}`,
  },
] as const
