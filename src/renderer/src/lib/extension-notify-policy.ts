/** 扩展 ctx.ui.notify → Sonner；Windows 上 toast 常伴随系统提示音 */

const DEDUPE_MS = 4000

const recentKeys = new Map<string, number>()

export function markExtensionNotifyAppReady(): void {
  recentKeys.clear()
}

const GIT_CRLF_WARNING_RE =
  /warning:\s+in the working copy of '[^']*',\s*(?:CRLF will be replaced by LF|LF will be replaced by CRLF) the next time Git touches it\s*/gi

const VERBOSE_GIT_CMD_RE =
  /Command failed:\s*git(?:\s+-c\s+[^\s]+)+\s+/gi

/**
 * Strip noisy Git CRLF warnings and verbose `-c key=val` flags from extension notifications
 * so a failed git command in an extension never balloons into a full-screen toast.
 */
export function formatExtensionNotifyMessage(rawMessage: string, maxChars = 320): string {
  if (!rawMessage) return ''
  let cleaned = rawMessage
    .replace(GIT_CRLF_WARNING_RE, '')
    .replace(VERBOSE_GIT_CMD_RE, 'git ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
  if (cleaned.length > maxChars) {
    cleaned = `${cleaned.slice(0, maxChars - 1)}…`
  }
  return cleaned
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