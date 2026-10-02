// Lazy chunk: Mermaid itself is only downloaded once a conversation contains a ```mermaid fence.
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'

export type MermaidTheme = {
  dark: boolean
  fontFamily: string
  background: string
  surface: string
  surfaceAlt: string
  text: string
  textMuted: string
  line: string
  accent: string
  accentSoft: string
}

export type MermaidResult = { svg: string } | { error: string }

/**
 * Mermaid already runs with securityLevel 'strict'; this second pass keeps only SVG/HTML markup,
 * including the <style> and foreignObject labels Mermaid emits, and drops scripts and handlers.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return String(
    DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      ADD_TAGS: ['foreignObject', 'style'],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'a'],
    }),
  )
}

/**
 * Mermaid sizes the root as width="100%" with a max-width, which stretches small diagrams (a
 * two-actor sequence) to the full column and blows their text up. Use the viewBox size instead;
 * CSS max-width: 100% still shrinks diagrams wider than the column.
 */
export function naturalSize(svg: string): string {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0]
  const box = root && /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(root)
  if (!root || !box) return svg
  const sized = root
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/^<svg/, `<svg width="${Math.ceil(Number(box[1]))}" height="${Math.ceil(Number(box[2]))}"`)
  // Shrinking a wide flowchart much below its size makes the labels unreadable; past 75% the
  // column scrolls sideways instead.
  const minWidth = `min-width: ${Math.ceil(Number(box[1]) * 0.75)}px;`
  const styled = /\sstyle="/.test(sized) ? sized.replace(/\sstyle="/, ` style="${minWidth} `) : sized.replace(/^<svg/, `<svg style="${minWidth}"`)
  return svg.replace(root, styled)
}

/** Parser messages span several lines (source excerpt, caret); keep the readable ones. */
export function summarizeMermaidError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-\s^]*$/.test(line) && !line.startsWith('...'))
  return lines.join(' ').replace(/\s+/g, ' ').slice(0, 240) || 'syntax error'
}

let initializedKey = ''
let queue: Promise<unknown> = Promise.resolve()
let seq = 0

function initialize(theme: MermaidTheme): void {
  const key = JSON.stringify(theme)
  if (key === initializedKey) return
  initializedKey = key
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme.dark,
    fontFamily: theme.fontFamily,
    // Top-level fontSize also overrides the sequence diagram's actor/message/note sizes.
    fontSize: 13,
    flowchart: { nodeSpacing: 36, rankSpacing: 42, padding: 10 },
    // Sequence diagrams default to 150×65 actors.
    sequence: {
      width: 120,
      height: 40,
      actorMargin: 48,
      boxMargin: 8,
      messageMargin: 32,
      mirrorActors: false,
    },
    themeVariables: {
      darkMode: theme.dark,
      fontFamily: theme.fontFamily,
      fontSize: '13px',
      background: theme.background,
      primaryColor: theme.surface,
      primaryTextColor: theme.text,
      primaryBorderColor: theme.accent,
      secondaryColor: theme.accentSoft,
      secondaryTextColor: theme.text,
      secondaryBorderColor: theme.line,
      tertiaryColor: theme.surfaceAlt,
      tertiaryTextColor: theme.text,
      tertiaryBorderColor: theme.line,
      lineColor: theme.textMuted,
      textColor: theme.text,
      mainBkg: theme.surface,
      nodeBorder: theme.accent,
      clusterBkg: theme.surfaceAlt,
      clusterBorder: theme.line,
      titleColor: theme.text,
      edgeLabelBackground: theme.background,
      noteBkgColor: theme.accentSoft,
      noteTextColor: theme.text,
      noteBorderColor: theme.accent,
      actorBkg: theme.surface,
      actorBorder: theme.accent,
      actorTextColor: theme.text,
      signalColor: theme.textMuted,
      signalTextColor: theme.text,
    },
  })
}

async function renderNow(code: string, theme: MermaidTheme): Promise<MermaidResult> {
  initialize(theme)
  const id = `pi-mermaid-${++seq}`
  try {
    await mermaid.parse(code)
    const { svg } = await mermaid.render(id, code)
    return { svg: naturalSize(sanitizeMermaidSvg(svg)) }
  } catch (error) {
    return { error: summarizeMermaidError(error) }
  } finally {
    // A failed render leaves its scratch container in <body>.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
}

/** Renders one diagram at a time: Mermaid keeps global state while it lays out. */
export function renderMermaid(code: string, theme: MermaidTheme): Promise<MermaidResult> {
  const next = queue.then(() => renderNow(code, theme))
  queue = next.catch(() => undefined)
  return next
}
