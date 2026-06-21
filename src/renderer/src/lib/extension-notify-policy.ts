/** 扩展 ctx.ui.notify → Sonner；Windows 上 toast 常伴随系统提示音 */

const DEDUPE_MS = 4000
/** 从 renderer 包加载起算，覆盖 Worker init 完成早于首屏的情况 */
const APP_BOOT = Date.now()
const STARTUP_SILENCE_NON_ERROR_MS = 20_000

const recentKeys = new Map<string, number>()

export function markExtensionNotifyAppReady(): void {
  recentKeys.clear()
}

function key(message: string, notifyType: string): string {
  return `${notifyType}::${message.trim()}`
}

/**
 * @returns false 表示应跳过 toast
 */
export function shouldShowExtensionNotify(message: string, notifyType: string): boolean {
  const msg = (message || '').trim()
  if (!msg) return false

  const t = notifyType || 'info'
  const now = Date.now()

  if (now - APP_BOOT < STARTUP_SILENCE_NON_ERROR_MS && t !== 'error') {
    return false
  }

  const k = key(msg, t)
  const last = recentKeys.get(k)
  if (last != null && now - last < DEDUPE_MS) return false
  recentKeys.set(k, now)
  if (recentKeys.size > 80) {
    for (const [kk, ts] of recentKeys) {
      if (now - ts > DEDUPE_MS) recentKeys.delete(kk)
    }
  }

  return true
}