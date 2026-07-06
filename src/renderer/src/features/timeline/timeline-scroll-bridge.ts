/** Timeline 滚动容器注册，供右侧固定进度条跳转（不随 chat-content-column 居中） */

let scrollEl: HTMLDivElement | null = null
let wheelAccum = 0
let wheelRaf: number | null = null

function flushWheelAccum() {
  wheelRaf = null
  if (!scrollEl || wheelAccum === 0) return
  const max = scrollEl.scrollHeight - scrollEl.clientHeight
  if (max <= 0) {
    wheelAccum = 0
    return
  }
  scrollEl.scrollTop = Math.max(0, Math.min(max, scrollEl.scrollTop + wheelAccum))
  wheelAccum = 0
  window.dispatchEvent(new Event('timeline-scroll'))
}

export function notifyTimelineScroll(): void {
  window.dispatchEvent(new Event('timeline-scroll'))
}

export function registerTimelineScrollEl(el: HTMLDivElement | null): void {
  scrollEl = el
}

export function getTimelineScrollMetrics(): { progress: number; scrollable: boolean } {
  if (!scrollEl) return { progress: 0, scrollable: false }
  const max = scrollEl.scrollHeight - scrollEl.clientHeight
  if (max <= 0) return { progress: 0, scrollable: false }
  return { progress: scrollEl.scrollTop / max, scrollable: true }
}

export function scrollTimelineToRatio(ratio: number): void {
  if (!scrollEl) return
  const max = scrollEl.scrollHeight - scrollEl.clientHeight
  if (max <= 0) return
  scrollEl.scrollTop = Math.max(0, Math.min(1, ratio)) * max
}

/** 中间列空白区滚轮：rAF 合并 delta，减少布局抖动 */
export function scrollTimelineByDelta(deltaY: number): boolean {
  if (!scrollEl || deltaY === 0) return false
  const max = scrollEl.scrollHeight - scrollEl.clientHeight
  if (max <= 0) return false
  wheelAccum += deltaY
  if (wheelRaf == null) {
    wheelRaf = requestAnimationFrame(flushWheelAccum)
  }
  return true
}