import { useEffect, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Columns2,
  Cpu,
  GripVertical,
  Layers,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { highlightPiSlot } from '@renderer/lib/theme/apply-ui-customization'
import type { TimelineUserMessageStyle } from '@shared/timeline-settings'
import type { CustomCssOverride } from '@shared/custom-theme'
import {
  COMPOSER_ACCESSORY_MODES,
  COMPOSER_BRANCH_MODES,
  COMPOSER_CONTEXT_POSITIONS,
  COMPOSER_CONTEXT_STYLES,
  COMPOSER_METRICS_MODES,
  COMPOSER_MODEL_STRIP_MODES,
  COMPOSER_PRESETS,
  COMPOSER_PURGE_MODES,
  COMPOSER_TOOLBAR_ITEMS,
  COMPOSER_TOOLS_MODES,
  COMPOSER_WORKTREE_MODES,
  DEFAULT_UI_CUSTOMIZATION,
  MID_TURN_PROSE_STYLES,
  PI_CSS_RECIPES,
  PI_UI_SLOTS,
  type ComposerAccessoryMode,
  type ComposerBranchMode,
  type ComposerContextPosition,
  type ComposerContextStyle,
  type ComposerMetricsMode,
  type ComposerModelStripMode,
  type ComposerPreset,
  type ComposerPurgeMode,
  type ComposerToolbarItemId,
  type ComposerToolsMode,
  type ComposerWorktreeMode,
  type MidTurnProseStyle,
  type PiSlotCategory,
  type UiCustomization,
} from '@shared/ui-customization'

const SLOT_BY_TOOLBAR_ITEM: Record<ComposerToolbarItemId, string | null> = {
  attach: 'composer-attach-btn',
  tools: 'composer-tools-btn',
  purge: 'composer-purge-btn',
  spacer: null,
  model: 'composer-model-strip',
  metrics: 'composer-metrics',
}

export function reorderToolbarItems(
  order: readonly ComposerToolbarItemId[],
  fromIndex: number,
  toIndex: number,
): ComposerToolbarItemId[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= order.length || toIndex >= order.length) {
    return [...order]
  }
  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (next: T) => void
  compact?: boolean
}) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-md border transition-colors',
              compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
              active
                ? 'border-[var(--brand)] bg-[var(--brand)]/12 font-medium text-foreground'
                : 'border-border/80 bg-background/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function WorkbenchReadingControls({
  userMessageStyle,
  onUserMessageStyleChange,
  ui,
  onUiChange,
  compact = false,
}: {
  userMessageStyle: TimelineUserMessageStyle
  onUserMessageStyleChange: (style: TimelineUserMessageStyle) => void
  ui: UiCustomization
  onUiChange: (patch: Partial<UiCustomization>) => void
  compact?: boolean
}) {
  const { t } = useTranslation()

  useEffect(() => () => highlightPiSlot(null), [])

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      {/* User Message Style */}
      <div
        onMouseEnter={() => highlightPiSlot('timeline-user-bubble')}
        onMouseLeave={() => highlightPiSlot(null)}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className={cn('font-medium text-foreground', compact ? 'text-[11.5px]' : 'text-sm')}>
            {t('settings:appearance.timelineUserMessageStyle')}
          </span>
        </div>
        {!compact && (
          <p className="text-xs text-muted-foreground/75">
            {t('settings:appearance.timelineUserMessageStyleDesc')}
          </p>
        )}
        <SegmentedPills
          compact={compact}
          value={userMessageStyle}
          onChange={onUserMessageStyleChange}
          options={[
            { id: 'bubble', label: t('settings:appearance.timelineUserMessageBubble') },
            { id: 'prompt-card', label: t('settings:appearance.timelineUserMessagePromptCard') },
          ]}
        />
      </div>

      {/* Mid-turn Prose Style */}
      <div
        onMouseEnter={() => highlightPiSlot('timeline-mid-prose')}
        onMouseLeave={() => highlightPiSlot(null)}
        className="flex flex-col gap-1.5"
      >
        <span className={cn('font-medium text-foreground', compact ? 'text-[11.5px]' : 'text-sm')}>
          {t('settings:appearance.workbench.midProseTitle')}
        </span>
        {!compact && (
          <p className="text-xs text-muted-foreground/75">
            {t('settings:appearance.workbench.midProseDesc')}
          </p>
        )}
        <SegmentedPills
          compact={compact}
          value={ui.midTurnProseStyle}
          onChange={(midTurnProseStyle: MidTurnProseStyle) => onUiChange({ midTurnProseStyle })}
          options={MID_TURN_PROSE_STYLES.map((id) => ({
            id,
            label: t(`settings:appearance.workbench.midProse.${id}`),
          }))}
        />
      </div>

      {/* Typography & Measure Sliders */}
      <div
        onMouseEnter={() => highlightPiSlot('timeline-column')}
        onMouseLeave={() => highlightPiSlot(null)}
        className={cn(
          'grid rounded-lg border border-border/65 bg-[var(--bg-1)]/40 p-3',
          compact ? 'grid-cols-1 gap-2.5' : 'grid-cols-1 gap-4 sm:grid-cols-3',
        )}
      >
        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-muted-foreground">{t('settings:appearance.workbench.readingFontSize')}</span>
            <span className="font-mono text-foreground">{ui.chatFontSize}px</span>
          </div>
          <input
            type="range"
            min={12.5}
            max={17}
            step={0.5}
            value={ui.chatFontSize}
            onDoubleClick={() => onUiChange({ chatFontSize: DEFAULT_UI_CUSTOMIZATION.chatFontSize })}
            onChange={(e) => onUiChange({ chatFontSize: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-muted-foreground">{t('settings:appearance.workbench.readingLineHeight')}</span>
            <span className="font-mono text-foreground">{ui.chatLineHeight.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={1.45}
            max={1.9}
            step={0.02}
            value={ui.chatLineHeight}
            onDoubleClick={() => onUiChange({ chatLineHeight: DEFAULT_UI_CUSTOMIZATION.chatLineHeight })}
            onChange={(e) => onUiChange({ chatLineHeight: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </label>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-muted-foreground">{t('settings:appearance.workbench.readingColumnWidth')}</span>
            <button
              type="button"
              onClick={() =>
                onUiChange({
                  chatColumnMax: ui.chatColumnMax === 0 ? DEFAULT_UI_CUSTOMIZATION.chatColumnMax : 0,
                })
              }
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors',
                ui.chatColumnMax === 0
                  ? 'bg-[var(--brand)]/15 font-medium text-[var(--brand)]'
                  : 'text-foreground hover:bg-accent',
              )}
            >
              {ui.chatColumnMax === 0 ? t('settings:appearance.workbench.fullWidth') : `${ui.chatColumnMax}px`}
            </button>
          </div>
          {ui.chatColumnMax !== 0 && (
            <input
              type="range"
              min={640}
              max={1280}
              step={20}
              value={ui.chatColumnMax}
              onDoubleClick={() => onUiChange({ chatColumnMax: DEFAULT_UI_CUSTOMIZATION.chatColumnMax })}
              onChange={(e) => onUiChange({ chatColumnMax: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function WorkbenchComposerControls({
  ui,
  onUiChange,
  compact = false,
}: {
  ui: UiCustomization
  onUiChange: (patch: Partial<UiCustomization>) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => () => highlightPiSlot(null), [])

  const order = ui.composerToolbarOrder

  const handleDragStart = (e: DragEvent<HTMLDivElement>, idx: number) => {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overIndex !== idx) setOverIndex(idx)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetIdx: number) => {
    e.preventDefault()
    const srcIdx = dragIndex ?? Number(e.dataTransfer.getData('text/plain'))
    if (Number.isFinite(srcIdx) && srcIdx !== targetIdx) {
      onUiChange({ composerToolbarOrder: reorderToolbarItems(order, srcIdx, targetIdx) })
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const moveBy = (idx: number, delta: -1 | 1) => {
    const nextIdx = idx + delta
    if (nextIdx < 0 || nextIdx >= order.length) return
    onUiChange({ composerToolbarOrder: reorderToolbarItems(order, idx, nextIdx) })
  }

  const isDefaultOrder = order.join(',') === COMPOSER_TOOLBAR_ITEMS.join(',')

  const renderItemIcon = (id: ComposerToolbarItemId) => {
    switch (id) {
      case 'attach':
        return <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      case 'tools':
        return <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      case 'purge':
        return <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      case 'spacer':
        return <Columns2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
      case 'model':
        return <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      case 'metrics':
        return <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    }
  }

  const renderItemModeControl = (id: ComposerToolbarItemId) => {
    switch (id) {
      case 'attach':
        return (
          <SegmentedPills
            compact
            value={ui.composerAttachVisible ? 'visible' : 'hidden'}
            onChange={(v) => onUiChange({ composerAttachVisible: v === 'visible' })}
            options={[
              { id: 'visible', label: t('settings:appearance.workbench.modes.visible') },
              { id: 'hidden', label: t('settings:appearance.workbench.modes.hidden') },
            ]}
          />
        )
      case 'tools':
        return (
          <SegmentedPills
            compact
            value={ui.composerToolsMode}
            onChange={(composerToolsMode: ComposerToolsMode) => onUiChange({ composerToolsMode })}
            options={COMPOSER_TOOLS_MODES.map((m) => ({
              id: m,
              label: t(`settings:appearance.workbench.modes.${m}`),
            }))}
          />
        )
      case 'purge':
        return (
          <SegmentedPills
            compact
            value={ui.composerPurgeMode}
            onChange={(composerPurgeMode: ComposerPurgeMode) => onUiChange({ composerPurgeMode })}
            options={COMPOSER_PURGE_MODES.map((m) => ({
              id: m,
              label: t(`settings:appearance.workbench.modes.${m}`),
            }))}
          />
        )
      case 'spacer':
        return null
      case 'model':
        return (
          <SegmentedPills
            compact
            value={ui.composerModelStripMode}
            onChange={(composerModelStripMode: ComposerModelStripMode) => onUiChange({ composerModelStripMode })}
            options={COMPOSER_MODEL_STRIP_MODES.map((m) => ({
              id: m,
              label: t(`settings:appearance.workbench.modes.${m}`),
            }))}
          />
        )
      case 'metrics':
        return (
          <SegmentedPills
            compact
            value={ui.composerMetricsMode}
            onChange={(composerMetricsMode: ComposerMetricsMode) => onUiChange({ composerMetricsMode })}
            options={COMPOSER_METRICS_MODES.map((m) => ({
              id: m,
              label: t(`settings:appearance.workbench.modes.${m}`),
            }))}
          />
        )
    }
  }

  const isItemHidden = (id: ComposerToolbarItemId): boolean => {
    if (id === 'attach') return !ui.composerAttachVisible
    if (id === 'tools') return ui.composerToolsMode === 'hidden'
    if (id === 'purge') return ui.composerPurgeMode === 'hidden'
    if (id === 'model') return ui.composerModelStripMode === 'hidden'
    if (id === 'metrics') return ui.composerMetricsMode === 'hidden'
    return false
  }

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3.5' : 'gap-5')}>
      {/* 1. Composer Shell Presets */}
      <div
        onMouseEnter={() => highlightPiSlot('composer-shell')}
        onMouseLeave={() => highlightPiSlot(null)}
        className="flex flex-col gap-1.5"
      >
        <div className={cn('font-medium text-foreground', compact ? 'text-[11.5px]' : 'text-sm')}>
          {t('settings:appearance.workbench.composerPresetLabel')}
        </div>
        <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
          {COMPOSER_PRESETS.map((preset) => {
            const active = ui.composerPreset === preset
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => onUiChange({ composerPreset: preset as ComposerPreset })}
                className={cn(
                  'flex flex-col items-start rounded-lg border p-2.5 text-left transition-all',
                  active
                    ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-foreground shadow-sm'
                    : 'border-border/75 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <span className="text-[12px] font-medium text-foreground">
                  {t(`settings:appearance.workbench.composerPresets.${preset}`)}
                </span>
                <span className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80">
                  {t(`settings:appearance.workbench.composerPresets.${preset}Hint`)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Input Height & Accessory Bar */}
      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
        <label
          onMouseEnter={() => highlightPiSlot('composer-input')}
          onMouseLeave={() => highlightPiSlot(null)}
          className="flex flex-col justify-center gap-1.5 rounded-lg border border-border/65 bg-[var(--bg-1)]/35 p-3"
        >
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-foreground">
              {t('settings:appearance.workbench.composerMaxHeight')}
            </span>
            <span className="font-mono text-muted-foreground">{ui.composerMaxHeight}px</span>
          </div>
          <input
            type="range"
            min={80}
            max={320}
            step={8}
            value={ui.composerMaxHeight}
            onDoubleClick={() => onUiChange({ composerMaxHeight: DEFAULT_UI_CUSTOMIZATION.composerMaxHeight })}
            onChange={(e) => onUiChange({ composerMaxHeight: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </label>

        <div
          onMouseEnter={() => highlightPiSlot('composer-accessory')}
          onMouseLeave={() => highlightPiSlot(null)}
          className="flex flex-col justify-center gap-1.5 rounded-lg border border-border/65 bg-[var(--bg-1)]/35 p-3"
        >
          <span className="text-[12px] font-medium text-foreground">
            {t('settings:appearance.workbench.composerAccessoryLabel')}
          </span>
          <SegmentedPills
            compact
            value={ui.composerAccessoryMode}
            onChange={(composerAccessoryMode: ComposerAccessoryMode) => onUiChange({ composerAccessoryMode })}
            options={COMPOSER_ACCESSORY_MODES.map((m) => ({
              id: m,
              label: t(`settings:appearance.workbench.composerAccessory.${m}`),
            }))}
          />
        </div>
      </div>

      {/* 3. Interactive Drag-and-Drop Toolbar Customizer */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className={cn('font-medium text-foreground', compact ? 'text-[11.5px]' : 'text-sm')}>
              {t('settings:appearance.workbench.toolbarOrderTitle')}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/75">
              {t('settings:appearance.workbench.toolbarOrderHint')}
            </p>
          </div>
          {!isDefaultOrder && (
            <button
              type="button"
              onClick={() => onUiChange({ composerToolbarOrder: [...COMPOSER_TOOLBAR_ITEMS] })}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t('settings:appearance.workbench.resetToolbarOrder')}</span>
            </button>
          )}
        </div>

        {/* Live Miniature Preview Strip */}
        <div
          aria-hidden
          className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-dashed border-border/80 bg-[var(--bg-1)]/50 px-2.5 py-1.5 text-[10.5px]"
        >
          {order.map((id) => {
            if (id === 'spacer') {
              return <div key="spacer" className="min-w-2 flex-1 border-b border-dotted border-border/70" />
            }
            if (isItemHidden(id)) return null
            const shortName = t(`settings:appearance.workbench.toolbarItems.${id}`).split('（')[0].split('(')[0].trim()
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded border border-border/65 bg-background px-1.5 py-0.5 text-foreground-secondary shadow-2xs"
              >
                {renderItemIcon(id)}
                {!(id === 'purge' && ui.composerPurgeMode === 'icon') && (
                  <span className="max-w-[76px] truncate">{shortName}</span>
                )}
              </span>
            )
          })}
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground text-[9px] text-background">
            ➤
          </span>
        </div>

        {/* Sortable Item List */}
        <div role="list" className="flex flex-col gap-1.5">
          {order.map((id, index) => {
            const isSpacer = id === 'spacer'
            const hidden = isItemHidden(id)
            const slot = SLOT_BY_TOOLBAR_ITEM[id]
            return (
              <div
                key={id}
                role="listitem"
                data-toolbar-item={id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={() => setOverIndex((cur) => (cur === index ? null : cur))}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onMouseEnter={() => highlightPiSlot(slot)}
                onMouseLeave={() => highlightPiSlot(null)}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 transition-all',
                  isSpacer
                    ? 'border-dashed border-[var(--brand)]/40 bg-[var(--brand)]/[0.04]'
                    : 'border-border/70 bg-background/75 hover:border-border',
                  hidden && 'opacity-60',
                  dragIndex === index && 'opacity-40',
                  overIndex === index && dragIndex !== index && 'ring-2 ring-[var(--brand)]/55',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
                      title={t('settings:appearance.workbench.toolbarOrderTitle')}
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                    {renderItemIcon(id)}
                    <span className={cn('text-[12px] font-medium leading-snug', isSpacer ? 'text-[var(--brand)]' : 'text-foreground')}>
                      {t(`settings:appearance.workbench.toolbarItems.${id}`)}
                    </span>
                  </div>

                  <div className="inline-flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`${t('settings:appearance.workbench.moveUp')}: ${id}`}
                      title={t('settings:appearance.workbench.moveUp')}
                      onClick={() => moveBy(index, -1)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={index === order.length - 1}
                      aria-label={`${t('settings:appearance.workbench.moveDown')}: ${id}`}
                      title={t('settings:appearance.workbench.moveDown')}
                      onClick={() => moveBy(index, 1)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {!isSpacer && (
                  <div className="pl-5">
                    {renderItemModeControl(id)}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Auxiliary Switches: Voice Mic & Live TPS */}
        <div className={cn('mt-1 grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
          <div
            onMouseEnter={() => highlightPiSlot('composer-voice-wrap')}
            onMouseLeave={() => highlightPiSlot(null)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/65 bg-background/60 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-foreground">
                {t('settings:appearance.workbench.composerVoiceLabel')}
              </div>
              {!compact && (
                <div className="text-[11px] text-muted-foreground/75">
                  {t('settings:appearance.workbench.composerVoiceDesc')}
                </div>
              )}
            </div>
            <Switch
              checked={ui.composerVoiceVisible}
              aria-label={t('settings:appearance.workbench.composerVoiceLabel')}
              onCheckedChange={(composerVoiceVisible) => onUiChange({ composerVoiceVisible })}
            />
          </div>

          <div
            onMouseEnter={() => highlightPiSlot('composer-metrics')}
            onMouseLeave={() => highlightPiSlot(null)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/65 bg-background/60 px-3 py-2"
          >
            <div className="text-[12px] font-medium text-foreground">
              {t('settings:appearance.workbench.composerTpsLabel')}
            </div>
            <Switch
              checked={ui.composerShowTps}
              aria-label={t('settings:appearance.workbench.composerTpsLabel')}
              onCheckedChange={(composerShowTps) => onUiChange({ composerShowTps })}
            />
          </div>
        </div>
      </div>

      {/* 4. Context Strip: Worktree & Git Branch Placement / Style / Visibility */}
      <div
        onMouseEnter={() => highlightPiSlot('composer-context-strip')}
        onMouseLeave={() => highlightPiSlot(null)}
        className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-background/55 p-3"
      >
        <div className="flex flex-col gap-0.5">
          <span className={cn('font-medium text-foreground', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
            {t('settings:appearance.workbench.contextStripTitle')}
          </span>
          {!compact && (
            <span className="text-[11px] text-muted-foreground/80">
              {t('settings:appearance.workbench.contextStripDesc')}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t('settings:appearance.workbench.contextPositionLabel')}
          </span>
          <SegmentedPills
            compact={compact}
            value={ui.composerContextPosition}
            onChange={(composerContextPosition: ComposerContextPosition) =>
              onUiChange({ composerContextPosition })
            }
            options={COMPOSER_CONTEXT_POSITIONS.map((p) => ({
              id: p,
              label: t(`settings:appearance.workbench.contextPositions.${p}`),
            }))}
          />
        </div>

        {ui.composerContextPosition !== 'hidden' && (
          <>
            {ui.composerContextPosition !== 'statusbar' && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('settings:appearance.workbench.contextStyleLabel')}
                </span>
                <SegmentedPills
                  compact={compact}
                  value={ui.composerContextStyle}
                  onChange={(composerContextStyle: ComposerContextStyle) =>
                    onUiChange({ composerContextStyle })
                  }
                  options={COMPOSER_CONTEXT_STYLES.map((st) => ({
                    id: st,
                    label: t(`settings:appearance.workbench.contextStyles.${st}`),
                  }))}
                />
              </div>
            )}

            <div
              onMouseEnter={(e) => {
                e.stopPropagation()
                highlightPiSlot('composer-worktree-btn')
              }}
              onMouseLeave={() => highlightPiSlot('composer-context-strip')}
              className="flex flex-col gap-1"
            >
              <span className="text-[11px] text-muted-foreground">
                {t('settings:appearance.workbench.contextWorktreeLabel')}
              </span>
              <SegmentedPills
                compact
                value={ui.composerWorktreeMode}
                onChange={(composerWorktreeMode: ComposerWorktreeMode) =>
                  onUiChange({ composerWorktreeMode })
                }
                options={COMPOSER_WORKTREE_MODES.map((m) => ({
                  id: m,
                  label: t(`settings:appearance.workbench.contextWorktreeModes.${m}`),
                }))}
              />
            </div>

            <div
              onMouseEnter={(e) => {
                e.stopPropagation()
                highlightPiSlot('composer-branch-btn')
              }}
              onMouseLeave={() => highlightPiSlot('composer-context-strip')}
              className="flex flex-col gap-1"
            >
              <span className="text-[11px] text-muted-foreground">
                {t('settings:appearance.workbench.contextBranchLabel')}
              </span>
              <SegmentedPills
                compact
                value={ui.composerBranchMode}
                onChange={(composerBranchMode: ComposerBranchMode) =>
                  onUiChange({ composerBranchMode })
                }
                options={COMPOSER_BRANCH_MODES.map((m) => ({
                  id: m,
                  label: t(`settings:appearance.workbench.contextBranchModes.${m}`),
                }))}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <span className="text-[11.5px] text-foreground-secondary">
                {t('settings:appearance.workbench.contextSwapLabel')}
              </span>
              <Switch
                checked={ui.composerContextSwapped}
                aria-label={t('settings:appearance.workbench.contextSwapLabel')}
                onCheckedChange={(composerContextSwapped) =>
                  onUiChange({ composerContextSwapped })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function WorkbenchCssInspectorControls({
  customCss,
  onCustomCssChange,
  enableElementPicker = false,
  compact = false,
}: {
  customCss: CustomCssOverride
  onCustomCssChange: (next: CustomCssOverride) => void
  enableElementPicker?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const [activeCat, setActiveCat] = useState<PiSlotCategory>('composer')

  useEffect(() => () => highlightPiSlot(null), [])

  useEffect(() => {
    if (!picking || !enableElementPicker) return

    const findSlotElement = (target: EventTarget | null): HTMLElement | null => {
      const el = target instanceof HTMLElement ? target : null
      if (!el || el.closest('.live-theme-studio')) return null
      return el.closest<HTMLElement>('[data-pi-slot]')
    }

    const onMove = (e: MouseEvent) => {
      const slotEl = findSlotElement(e.target)
      highlightPiSlot(slotEl?.dataset.piSlot ?? null)
    }

    const onClick = (e: MouseEvent) => {
      const rawEl = e.target instanceof HTMLElement ? e.target : null
      if (rawEl?.closest('.live-theme-studio')) return
      e.preventDefault()
      e.stopPropagation()
      const slotEl = findSlotElement(e.target)
      const slotName = slotEl?.dataset.piSlot
      highlightPiSlot(null)
      setPicking(false)
      if (!slotName) return
      const descriptor = PI_UI_SLOTS.find((s) => s.slot === slotName)
      const snippet = descriptor?.sampleCss ?? `[data-pi-slot="${slotName}"] {\n  \n}`
      const base = customCss.css.trimEnd()
      onCustomCssChange({
        enabled: true,
        css: base ? `${base}\n\n${snippet}` : snippet,
      })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        highlightPiSlot(null)
        setPicking(false)
      }
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      highlightPiSlot(null)
    }
  }, [customCss.css, enableElementPicker, onCustomCssChange, picking])

  const appendSnippet = (snippet: string) => {
    const base = customCss.css.trimEnd()
    if (base.includes(snippet.trim())) return
    onCustomCssChange({
      enabled: true,
      css: base ? `${base}\n\n${snippet}` : snippet,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {enableElementPicker && (
        <button
          type="button"
          aria-pressed={picking}
          onClick={() => {
            if (picking) {
              highlightPiSlot(null)
              setPicking(false)
            } else {
              setPicking(true)
            }
          }}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors',
            picking
              ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
              : 'border-border bg-background/80 text-foreground hover:bg-accent',
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>
            {picking
              ? t('settings:appearance.workbench.cssPickingActive')
              : t('settings:appearance.workbench.cssPickElement')}
          </span>
        </button>
      )}

      {/* One-click CSS Recipes */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[11.5px] font-medium text-muted-foreground">
          {t('settings:appearance.workbench.cssRecipesTitle')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PI_CSS_RECIPES.map((recipe) => {
            const included = customCss.css.includes(recipe.css.trim())
            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => appendSnippet(recipe.css)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  included
                    ? 'border-[var(--brand)]/60 bg-[var(--brand)]/10 text-foreground'
                    : 'border-border/75 bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {included && <Check className="h-3 w-3 text-[var(--brand)]" />}
                <span>{t(`settings:appearance.workbench.recipes.${recipe.labelKey}`)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Categorized [data-pi-slot] Selector Reference */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/65 bg-[var(--bg-1)]/35 p-2.5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-foreground">
            {t('settings:appearance.workbench.cssSlotsTitle')}
          </span>
          <SegmentedPills
            compact
            value={activeCat}
            onChange={(cat) => setActiveCat(cat)}
            options={(['composer', 'timeline', 'shell'] as const).map((cat) => ({
              id: cat,
              label: t(`settings:appearance.workbench.slotCategories.${cat}`),
            }))}
          />
        </div>
        <div className={cn('grid gap-1', compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
          {PI_UI_SLOTS.filter((s) => s.category === activeCat).map((s) => (
            <button
              key={s.slot}
              type="button"
              onMouseEnter={() => highlightPiSlot(s.slot)}
              onMouseLeave={() => highlightPiSlot(null)}
              onClick={() => appendSnippet(s.sampleCss)}
              className="flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1.5 text-left text-[11.5px] transition-colors hover:border-border/70 hover:bg-background"
            >
              <span className="min-w-0 flex-1 leading-snug text-foreground">
                {t(`settings:appearance.workbench.slots.${s.labelKey}`)}
              </span>
              <code className="shrink-0 rounded bg-[var(--bg-2)]/65 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {s.slot}
              </code>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
