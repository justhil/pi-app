import { BrowserWindow } from 'electron'

const MIN_DIM = 32
const MAX_DIM = 4096
const MAX_SCALE = 3

export interface ExportSvgPngRequest {
  svg: string
  width?: number
  height?: number
  scale?: number
  padding?: number
  background?: string
  fontFamily?: string
}

export interface ExportSvgPngResult {
  ok: boolean
  data?: string
  mimeType?: 'image/png'
  width?: number
  height?: number
  error?: string
}

/** Parse natural SVG dimensions from viewBox / width / height attributes. */
export function parseSvgDimensions(svg: string): { width: number; height: number } {
  const rootMatch = /<svg\b[^>]*>/i.exec(svg)
  const root = rootMatch?.[0] ?? ''
  const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(root)
  if (viewBox) {
    const w = Math.ceil(Number(viewBox[1]))
    const h = Math.ceil(Number(viewBox[2]))
    if (w > 0 && h > 0) return { width: clampDim(w), height: clampDim(h) }
  }
  const wAttr = /\bwidth\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(root)
  const hAttr = /\bheight\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(root)
  const w = wAttr ? Math.ceil(Number(wAttr[1])) : 800
  const h = hAttr ? Math.ceil(Number(hAttr[1])) : 500
  return { width: clampDim(w), height: clampDim(h) }
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 800
  return Math.min(MAX_DIM, Math.max(MIN_DIM, Math.ceil(n)))
}

function stripDangerousSvgMarkup(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/**
 * Render an SVG (including Mermaid `<foreignObject>` HTML labels and system fonts) to a crisp
 * lossless 2x/3x PNG using a short-lived, script-disabled offscreen Electron BrowserWindow.
 */
export async function exportSvgToPng(req: ExportSvgPngRequest): Promise<ExportSvgPngResult> {
  const rawSvg = String(req.svg || '').trim()
  if (!rawSvg || !rawSvg.includes('<svg')) {
    return { ok: false, error: 'invalid_svg' }
  }

  const parsed = parseSvgDimensions(rawSvg)
  const baseWidth = clampDim(req.width ?? parsed.width)
  const baseHeight = clampDim(req.height ?? parsed.height)
  const padding = Math.min(96, Math.max(0, Math.round(req.padding ?? 20)))
  const requestedScale = Math.min(MAX_SCALE, Math.max(1, Number(req.scale ?? 2)))
  // Guard max bitmap size <= 4096px per edge so giant diagrams never OOM Chromium.
  const maxSafeScale = Math.min(
    requestedScale,
    MAX_DIM / Math.max(1, baseWidth + padding * 2),
    MAX_DIM / Math.max(1, baseHeight + padding * 2),
  )
  const scale = Math.max(1, Number(maxSafeScale.toFixed(2)))

  const outW = Math.min(MAX_DIM, Math.ceil((baseWidth + padding * 2) * scale))
  const outH = Math.min(MAX_DIM, Math.ceil((baseHeight + padding * 2) * scale))
  const safeBg = req.background && /^[#a-zA-Z0-9(),.\s%-]+$/.test(req.background) ? req.background : '#ffffff'
  const safeFont =
    req.fontFamily && !/[<>"{};]/.test(req.fontFamily)
      ? req.fontFamily
      : 'system-ui, -apple-system, "Segoe UI", sans-serif'

  const cleanSvg = stripDangerousSvgMarkup(rawSvg)
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${outW}px;
    height: ${outH}px;
    overflow: hidden;
    background: ${safeBg};
    font-family: ${safeFont};
  }
  .stage {
    width: ${baseWidth + padding * 2}px;
    height: ${baseHeight + padding * 2}px;
    padding: ${padding}px;
    box-sizing: border-box;
    transform: scale(${scale});
    transform-origin: top left;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stage > svg {
    display: block;
    width: ${baseWidth}px !important;
    height: ${baseHeight}px !important;
    max-width: none !important;
    min-width: 0 !important;
  }
</style>
</head>
<body><div class="stage">${cleanSvg}</div></body>
</html>`

  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: outW,
    height: outH,
    useContentSize: true,
    enableLargerThanScreen: true,
    backgroundColor: safeBg.startsWith('#') ? safeBg : '#ffffff',
    webPreferences: {
      sandbox: true,
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    win.setContentSize(outW, outH)
    await Promise.race([
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('svg_render_timeout')), 8_000)),
    ])
    // Give Chromium one frame to finish foreignObject layout & font rasterization.
    await new Promise((r) => setTimeout(r, 80))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: outW, height: outH })
    if (image.isEmpty()) return { ok: false, error: 'empty_png_capture' }
    const png = image.toPNG()
    const size = image.getSize()
    return {
      ok: true,
      data: png.toString('base64'),
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
