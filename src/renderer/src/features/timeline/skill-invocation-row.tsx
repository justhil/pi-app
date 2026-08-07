import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const SKILL_OPEN_RE = /^<skill\s+name="([^"]*)"/

export function parseSkillInvocationName(text: string): string | undefined {
  const m = SKILL_OPEN_RE.exec(String(text || '').trimStart())
  return m?.[1] || undefined
}

export function isSkillInvocationMessage(text: string): boolean {
  return SKILL_OPEN_RE.test(String(text || '').trimStart())
}

/**
 * skill 调用折叠行：pi 把 skill 内容作为独立用户消息注入（`<skill name=...>` 开头）。
 * 摘要一行（默认折叠），点击展开全文。不受滑动窗口 N 限制；展开状态按会话记忆。
 */
export const SkillInvocationRow = memo(function SkillInvocationRow({
  item,
}: {
  item: TimelineItem
}) {
  const { t } = useTranslation()
  const itemId = String(item.id)
  const expanded = useUIStore((s) => {
    const sessionKey =
      normalizeSessionFileKey(s.historySessionFile || '') ||
      s.historySessionFile ||
      '__none__'
    return s.skillExpandBySession[sessionKey]?.[itemId]
  })
  const setExpanded = useUIStore((s) => s.setSkillInvocationExpanded)
  const name = parseSkillInvocationName(String(item.text || ''))
  const open = expanded === true

  return (
    <div className="mb-0">
      <button
        type="button"
        onClick={() => setExpanded(itemId, open ? false : true)}
        className="timeline-activity-row"
      >
        <ChevronRight
          className={cn('chevron-expand h-3 w-3 timeline-text-placeholder', open && 'rotate-90')}
        />
        <span className="timeline-activity-label timeline-skill-invocation-label">
          {t('timeline:skillInvoked', { name: name || t('timeline:skillUnknown') })}
        </span>
      </button>
      {open ? (
        <div
          data-independent-scroll
          className="timeline-skill-invocation-body ml-3.5 max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words border-l border-border/35 pl-2 font-mono text-[12px] leading-[1.55] text-foreground-secondary"
        >
          {String(item.text || '')}
        </div>
      ) : null}
    </div>
  )
})
