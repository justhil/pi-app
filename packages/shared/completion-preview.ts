export type CompletionOutcome = 'success' | 'failed' | 'cancelled'
export type CompletionPreviewMode = 'response' | 'fixed'
export type CompletionDeliveryMode = 'auto' | 'custom' | 'system'

const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._\-+/=]+)\b/gi
const QUERY_SECRET_RE = /([?&](?:token|key|password|secret|access_token|api_key)=)[^&\s]+/gi
const PATH_RE = /(?:[A-Za-z]:\\|\\\\|\/(?:home|Users|var|tmp|opt)\/)[^\s]+/g
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function normalizePreviewWhitespace(text: string): string {
  return String(text || '')
    .replace(CONTROL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncateGraphemes(text: string, max: number): string {
  const value = String(text || '')
  if (max <= 0 || !value) return ''
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locales?: string | string[], options?: Intl.SegmenterOptions) => Intl.Segmenter
  }).Segmenter
  const units = Segmenter
    ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment)
    : [...value]
  if (units.length <= max) return units.join('')
  return `${units.slice(0, max).join('')}…`
}

export function redactCompletionPreview(text: string): string {
  return normalizePreviewWhitespace(text)
    .replace(SECRET_RE, '[redacted]')
    .replace(QUERY_SECRET_RE, '$1[redacted]')
    .replace(PATH_RE, '[path]')
}

export function sanitizeCompletionPreview(text: string | undefined, maxGraphemes: number): string {
  return truncateGraphemes(redactCompletionPreview(text || ''), maxGraphemes)
}

export const COMPLETION_TITLE_MAX = 40
export const COMPLETION_BODY_MAX = 140

/** Languages the main-process notification copy is written in (mirrors the app language). */
export type CompletionUiLanguage = 'zh' | 'en' | 'ru'

export type CompletionCopyInput = {
  language: CompletionUiLanguage
  outcome: CompletionOutcome
  promptPreview?: string
  responsePreview?: string
  durationMs?: number
  previewMode: CompletionPreviewMode
  projectLabel?: string
  isTest?: boolean
}

export type CompletionCopy = {
  projectLabel: string
  title: string
  body: string
  meta: string
  openLabel: string
  dismissLabel: string
  muteLabel: string
}

/** Russian plural: 1 секунда / 2 секунды / 5 секунд. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function formatDuration(language: CompletionUiLanguage, durationMs?: number): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return ''
  const sec = Math.max(0, Math.round(durationMs / 1000))
  if (language === 'zh') return sec > 0 ? `${sec} 秒` : '不到 1 秒'
  if (language === 'ru') return sec > 0 ? `${sec} ${ruPlural(sec, 'секунду', 'секунды', 'секунд')}` : 'меньше секунды'
  return sec > 0 ? `${sec}s` : '<1s'
}

function outcomeLabel(language: CompletionUiLanguage, outcome: CompletionOutcome): string {
  if (language === 'zh') {
    if (outcome === 'failed') return '失败'
    if (outcome === 'cancelled') return '已取消'
    return '完成'
  }
  if (language === 'ru') {
    if (outcome === 'failed') return 'С ошибками'
    if (outcome === 'cancelled') return 'Отменено'
    return 'Готово'
  }
  if (outcome === 'failed') return 'Failed'
  if (outcome === 'cancelled') return 'Cancelled'
  return 'Done'
}

export function buildCompletionNotificationCopy(input: CompletionCopyInput): CompletionCopy {
  const zh = input.language === 'zh'
  const ru = input.language === 'ru'
  if (input.isTest) {
    return {
      projectLabel: 'pi Desktop',
      title: ru ? 'Тестовое уведомление' : zh ? '测试提醒' : 'Test notification',
      body: ru
        ? 'Задача завершена, можно вернуться в сессию.'
        : zh
          ? '任务完成，可以返回查看'
          : 'Task finished. You can return to the session.',
      meta: ru ? 'Тест' : zh ? '测试' : 'Test',
      openLabel: ru ? 'Вернуться в приложение' : zh ? '返回应用' : 'Back to app',
      dismissLabel: ru ? 'Закрыть' : zh ? '关闭' : 'Dismiss',
      muteLabel: ru ? 'Не беспокоить 30 мин' : zh ? '勿扰 30 分钟' : 'Mute 30 min',
    }
  }

  const title =
    sanitizeCompletionPreview(input.promptPreview, COMPLETION_TITLE_MAX) ||
    (ru ? 'Задача завершена' : zh ? '任务已完成' : 'Task finished')
  const rawBody = input.previewMode === 'response' ? input.responsePreview : ''
  const body =
    sanitizeCompletionPreview(rawBody, COMPLETION_BODY_MAX) ||
    (ru
      ? 'Задача завершена, можно вернуться в сессию.'
      : zh
        ? '任务完成，可以返回查看'
        : 'Task finished. You can return to the session.')
  const duration = formatDuration(input.language, input.durationMs)
  const meta = [outcomeLabel(input.language, input.outcome), duration].filter(Boolean).join(' · ')

  return {
    projectLabel: input.projectLabel?.trim() || 'pi Desktop',
    title,
    body,
    meta,
    openLabel: ru ? 'Открыть сессию' : zh ? '返回会话' : 'Open session',
    dismissLabel: ru ? 'Закрыть' : zh ? '关闭' : 'Dismiss',
    muteLabel: ru ? 'Не беспокоить 30 мин' : zh ? '勿扰 30 分钟' : 'Mute 30 min',
  }
}

export function normalizeCompletionTimeoutSeconds(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 15
  return Math.min(60, Math.max(5, Math.round(n)))
}

export function normalizeCompletionPreviewMode(raw: unknown): CompletionPreviewMode {
  return raw === 'fixed' ? 'fixed' : 'response'
}

export function normalizeCompletionDelivery(raw: unknown): CompletionDeliveryMode {
  if (raw === 'custom' || raw === 'system') return raw
  return 'auto'
}

export function normalizeDndUntil(raw: unknown, now = Date.now()): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= now) return null
  return Math.round(n)
}
