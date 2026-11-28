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
export type CompletionUiLanguage = 'zh' | 'en' | 'ru' | 'ja'

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
  if (language === 'ja') return sec > 0 ? `${sec} 秒` : '1 秒未満'
  if (language === 'zh') return sec > 0 ? `${sec} 秒` : '不到 1 秒'
  if (language === 'ru') return sec > 0 ? `${sec} ${ruPlural(sec, 'секунду', 'секунды', 'секунд')}` : 'меньше секунды'
  return sec > 0 ? `${sec}s` : '<1s'
}

function outcomeLabel(language: CompletionUiLanguage, outcome: CompletionOutcome): string {
  if (language === 'ja') {
    if (outcome === 'failed') return '失敗'
    if (outcome === 'cancelled') return 'キャンセル'
    return '完了'
  }
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

const notificationLabels = {
  en: {
    testTitle: 'Test notification', test: 'Test', title: 'Task finished',
    body: 'Task finished. You can return to the session.',
    back: 'Back to app', open: 'Open session', dismiss: 'Dismiss', mute: 'Mute 30 min',
  },
  zh: {
    testTitle: '测试提醒', test: '测试', title: '任务已完成',
    body: '任务完成，可以返回查看',
    back: '返回应用', open: '返回会话', dismiss: '关闭', mute: '勿扰 30 分钟',
  },
  ru: {
    testTitle: 'Тестовое уведомление', test: 'Тест', title: 'Задача завершена',
    body: 'Задача завершена, можно вернуться в сессию.',
    back: 'Вернуться в приложение', open: 'Открыть сессию', dismiss: 'Закрыть', mute: 'Не беспокоить 30 мин',
  },
  ja: {
    testTitle: 'テスト通知', test: 'テスト', title: 'タスクが完了しました',
    body: 'タスクが完了しました。セッションに戻って確認できます。',
    back: 'アプリに戻る', open: 'セッションを開く', dismiss: '閉じる', mute: '30 分間通知を停止',
  },
} satisfies Record<CompletionUiLanguage, Record<string, string>>

export function buildCompletionNotificationCopy(input: CompletionCopyInput): CompletionCopy {
  const labels = notificationLabels[input.language]
  if (input.isTest) {
    return {
      projectLabel: 'pi Desktop',
      title: labels.testTitle,
      body: labels.body,
      meta: labels.test,
      openLabel: labels.back,
      dismissLabel: labels.dismiss,
      muteLabel: labels.mute,
    }
  }

  const title = sanitizeCompletionPreview(input.promptPreview, COMPLETION_TITLE_MAX) || labels.title
  const rawBody = input.previewMode === 'response' ? input.responsePreview : ''
  const body = sanitizeCompletionPreview(rawBody, COMPLETION_BODY_MAX) || labels.body
  const duration = formatDuration(input.language, input.durationMs)
  const meta = [outcomeLabel(input.language, input.outcome), duration].filter(Boolean).join(' · ')

  return {
    projectLabel: input.projectLabel?.trim() || 'pi Desktop',
    title,
    body,
    meta,
    openLabel: labels.open,
    dismissLabel: labels.dismiss,
    muteLabel: labels.mute,
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
