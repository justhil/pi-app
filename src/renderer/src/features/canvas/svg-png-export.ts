import { ipcClient } from '@renderer/lib/ipc-client'

export interface SvgExportOptions {
  svgElement?: SVGSVGElement | null
  svgMarkup?: string
  filename?: string
  scale?: 1 | 2 | 3
  padding?: number
  background?: string
}

function readThemeExportContext(): { background: string; fontFamily: string } {
  if (typeof document === 'undefined') {
    return { background: '#ffffff', fontFamily: 'sans-serif' }
  }
  const rootStyle = getComputedStyle(document.documentElement)
  const dark = document.documentElement.classList.contains('dark')
  const bg = rootStyle.getPropertyValue('--bg-base').trim() || (dark ? '#16171c' : '#ffffff')
  const fontFamily = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  return { background: bg, fontFamily }
}

function extractSvgStringAndSize(opts: SvgExportOptions): {
  svg: string
  width: number
  height: number
} | null {
  let svg = opts.svgMarkup?.trim() || ''
  let width = 0
  let height = 0

  if (opts.svgElement) {
    const el = opts.svgElement
    const clone = el.cloneNode(true) as SVGSVGElement
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    svg = new XMLSerializer().serializeToString(clone)

    const vb = el.viewBox?.baseVal
    if (vb && vb.width > 0 && vb.height > 0) {
      width = Math.ceil(vb.width)
      height = Math.ceil(vb.height)
    } else {
      const rect = el.getBoundingClientRect()
      width = Math.ceil(rect.width)
      height = Math.ceil(rect.height)
    }
  }

  if (!svg || !svg.includes('<svg')) return null

  if (width <= 0 || height <= 0) {
    const vbMatch = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(svg)
    if (vbMatch) {
      width = Math.ceil(Number(vbMatch[1]))
      height = Math.ceil(Number(vbMatch[2]))
    } else {
      const wAttr = /\bwidth\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(svg)
      const hAttr = /\bheight\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i.exec(svg)
      width = wAttr ? Math.ceil(Number(wAttr[1])) : 800
      height = hAttr ? Math.ceil(Number(hAttr[1])) : 500
    }
  }

  return {
    svg,
    width: Math.max(32, Math.min(4096, width || 800)),
    height: Math.max(32, Math.min(4096, height || 500)),
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

function browserCanvasFallback(
  svg: string,
  width: number,
  height: number,
  scale: number,
  padding: number,
  background: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const encoded = btoa(unescape(encodeURIComponent(svg)))
    const img = new window.Image()
    img.onload = () => {
      try {
        const outW = Math.ceil((width + padding * 2) * scale)
        const outH = Math.ceil((height + padding * 2) * scale)
        const canvas = document.createElement('canvas')
        canvas.width = outW
        canvas.height = outH
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas_2d_unavailable'))
          return
        }
        ctx.fillStyle = background
        ctx.fillRect(0, 0, outW, outH)
        ctx.scale(scale, scale)
        ctx.drawImage(img, padding, padding, width, height)
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('canvas_to_blob_failed'))
        }, 'image/png')
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.onerror = () => reject(new Error('svg_image_decode_failed'))
    img.src = `data:image/svg+xml;base64,${encoded}`
  })
}

/**
 * Render an SVG (including Mermaid diagrams with `<foreignObject>`) to a crisp high-DPI PNG Blob.
 * Uses Electron main-process script-disabled offscreen capture first for lossless fidelity,
 * falling back to browser `<canvas>` when running outside Electron.
 */
export async function renderSvgToPngBlob(opts: SvgExportOptions): Promise<{
  blob: Blob
  width: number
  height: number
}> {
  const extracted = extractSvgStringAndSize(opts)
  if (!extracted) throw new Error('svg_not_ready')

  const scale = opts.scale ?? 2
  const padding = opts.padding ?? 20
  const theme = readThemeExportContext()
  const background = opts.background ?? theme.background

  if (typeof window !== 'undefined' && window.piDesktop) {
    const res = await ipcClient.invoke('canvas.svgToPng', {
      svg: extracted.svg,
      width: extracted.width,
      height: extracted.height,
      scale,
      padding,
      background,
      fontFamily: theme.fontFamily,
    })
    if (res?.ok && typeof res.data === 'string' && res.data.length > 0) {
      return {
        blob: base64ToBlob(res.data, 'image/png'),
        width: Number(res.width) || Math.ceil((extracted.width + padding * 2) * scale),
        height: Number(res.height) || Math.ceil((extracted.height + padding * 2) * scale),
      }
    }
  }

  const blob = await browserCanvasFallback(
    extracted.svg,
    extracted.width,
    extracted.height,
    scale,
    padding,
    background,
  )
  return {
    blob,
    width: Math.ceil((extracted.width + padding * 2) * scale),
    height: Math.ceil((extracted.height + padding * 2) * scale),
  }
}

export async function downloadSvgAsPng(opts: SvgExportOptions): Promise<{ width: number; height: number }> {
  const { blob, width, height } = await renderSvgToPngBlob(opts)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename || 'diagram-2x.png'
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_500)
  return { width, height }
}

export async function copySvgAsPng(opts: SvgExportOptions): Promise<{ width: number; height: number }> {
  const { blob, width, height } = await renderSvgToPngBlob(opts)
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('clipboard_image_unsupported')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  return { width, height }
}
