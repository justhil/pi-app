/** 输入/对话区最大宽度：按物理全屏宽度 2/5 封顶，窗口变窄时仍可用 min(100%, …) 收缩 */

const COMPOSER_SCREEN_RATIO = 0.4
const TIMELINE_EXTRA_PX = 48
const TIMELINE_SCREEN_RATIO_CAP = 0.46

export function syncChatContentMaxWidths(): void {
  const sw = typeof screen !== 'undefined' && screen.width > 0 ? screen.width : 1920
  const composerPx = Math.round(sw * COMPOSER_SCREEN_RATIO)
  const timelinePx = Math.round(Math.min(sw * TIMELINE_SCREEN_RATIO_CAP, composerPx + TIMELINE_EXTRA_PX))
  const root = document.documentElement
  root.style.setProperty('--composer-content-max-px', `${composerPx}px`)
  root.style.setProperty('--timeline-content-max-px', `${timelinePx}px`)
}