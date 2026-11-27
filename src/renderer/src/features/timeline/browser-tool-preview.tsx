import { useTranslation } from 'react-i18next'
import { Globe } from '@renderer/components/icons'
import { extractToolText } from '@extension-compat/renderer/tool-output'
import type { ToolTimelineItem } from './tool-preview-shell'
import { CodeBlockView } from './code-block-view'

function extractInlineToolImages(raw: string): Array<{ mimeType: string; data: string }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.content)) {
      return parsed.content.filter(
        (c: { type?: string; mimeType?: string; data?: string }): c is { mimeType: string; data: string } =>
          c?.type === 'image' && typeof c.mimeType === 'string' && typeof c.data === 'string',
      )
    }
  } catch {
    /* non-JSON raw text */
  }
  return []
}

export function BrowserToolPreview({ item }: { item: ToolTimelineItem }) {
  const { t } = useTranslation()
  const rawText = extractToolText(item.toolOutput || '').trim()
  const images = extractInlineToolImages(item.toolOutput || '')

  if (!rawText && images.length === 0) {
    return (
      <div className="px-2 py-1.5 text-[11px] text-foreground-secondary/70">
        {item.toolPhase === 'start' || item.toolPhase === 'update'
          ? t('common:loading')
          : t('timeline:mcp.noOutput')}
      </div>
    )
  }

  const yamlMatch = rawText.match(/```yaml\n([\s\S]*?)\n```/)
  const withoutYaml = yamlMatch ? rawText.replace(yamlMatch[0], '').trim() : rawText

  const sections = withoutYaml
    .split(/(?=^###\s+)/m)
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div className="space-y-2 py-1">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <img
              key={idx}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt="Browser capture"
              className="max-h-[240px] rounded-lg border border-border/65 object-contain shadow-xs"
            />
          ))}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-border/35 bg-[var(--bg-1)]/35 p-2 text-[11.5px]">
          {sections.map((sec, idx) => {
            const firstNl = sec.indexOf('\n')
            const heading = firstNl >= 0 ? sec.slice(0, firstNl).replace(/^###\s+/, '').trim() : ''
            const body = firstNl >= 0 ? sec.slice(firstNl + 1).trim() : sec
            return (
              <div key={idx} className="space-y-0.5">
                {heading ? (
                  <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {idx === 0 ? <Globe className="h-3 w-3 shrink-0" /> : null}
                    <span>{heading}</span>
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground-secondary">
                  {body}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {yamlMatch?.[1] ? (
        <CodeBlockView code={yamlMatch[1]} lang="yaml" previewLines={10} defaultExpanded={false} />
      ) : null}
    </div>
  )
}

export function buildBrowserToolSummary(toolName: string, a: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  switch (toolName) {
    case 'browser_navigate':
      return str(a.url)
    case 'browser_snapshot': {
      if (a.query) return `query: "${str(a.query)}"`
      if (a.target) return `target: ${str(a.target)}`
      if (a.allTabs) return 'all open tabs'
      if (a.mode === 'text') return 'page text'
      return 'interactive tree'
    }
    case 'browser_click':
      if (a.target) return `${a.doubleClick ? 'double-click ' : ''}${str(a.target)}`
      if (typeof a.x === 'number' && typeof a.y === 'number') return `(${Math.round(a.x)}, ${Math.round(a.y)})`
      return ''
    case 'browser_hover':
      return str(a.target)
    case 'browser_drag':
      return `${str(a.startTarget)} → ${str(a.endTarget)}`
    case 'browser_type': {
      const text = str(a.text)
      const snippet = text.length > 26 ? `${text.slice(0, 26)}…` : text
      return snippet ? `"${snippet}" → ${str(a.target)}` : str(a.target)
    }
    case 'browser_fill_form':
      return Array.isArray(a.fields) ? `${a.fields.length} field(s)` : ''
    case 'browser_select_option':
      return `${str(a.target)} = ${Array.isArray(a.values) ? a.values.join(', ') : ''}`
    case 'browser_press_key':
      return str(a.key)
    case 'browser_mouse_wheel':
      return `Δy=${typeof a.deltaY === 'number' ? a.deltaY : 500}`
    case 'browser_wait_for':
      if (a.text) return `text "${str(a.text)}"`
      if (a.textGone) return `gone "${str(a.textGone)}"`
      if (typeof a.time === 'number') return `${a.time}s`
      return ''
    case 'browser_tabs':
      return [str(a.action), str(a.url)].filter(Boolean).join(' · ')
    case 'browser_take_screenshot':
      return a.fullPage ? 'full page' : str(a.target) || 'viewport'
    case 'browser_devtools':
      return str(a.kind)
    case 'browser_evaluate':
      return str(a.function).replace(/\s+/g, ' ').slice(0, 56)
    case 'browser_batch':
      return Array.isArray(a.steps) ? `${a.steps.length} step(s)` : ''
    case 'browser_request_help':
      return str(a.prompt).slice(0, 60)
    case 'browser_download':
      return str(a.saveAs) || str(a.target)
    case 'browser_site_notes':
      return [str(a.action), str(a.host)].filter(Boolean).join(' · ')
    default:
      return str(a.target) || str(a.url)
  }
}
