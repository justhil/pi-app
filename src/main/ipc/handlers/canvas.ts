import { app } from 'electron'
import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { resolveCanvasToolFromRenderer } from '../../canvas/canvas-tool-bridge'
import {
  listAdbDevices,
  sendAdbInput,
  startAdbStream,
  stopAdbStream,
  stopAllAdbStreams,
} from '../../canvas/adb-service'
import {
  readCanvasFile,
  unwatchAllCanvasFiles,
  unwatchCanvasFile,
  watchCanvasFile,
} from '../../canvas/canvas-file-service'
import { exportSvgToPng } from '../../canvas/svg-png-exporter'
import { getMainWindow } from '../../window'

const toolResponseSchema = z.object({
  callId: z.string().min(1).max(128),
  isError: z.boolean().optional(),
  content: z
    .array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
      ]),
    )
    .min(1),
})

const captureSurfaceSchema = z.object({
  rect: z.object({
    x: z.number().min(0).max(20_000),
    y: z.number().min(0).max(20_000),
    width: z.number().min(16).max(20_000),
    height: z.number().min(16).max(20_000),
  }),
  maxWidth: z.number().min(200).max(1920).optional(),
})

const prototypeCompileSchema = z.object({
  mode: z.enum(['html', 'react']).optional(),
  code: z.string().max(1_500_000),
  css: z.string().max(500_000).optional(),
  files: z.record(z.string(), z.string().max(500_000)).optional(),
  filePath: z.string().max(2048).optional(),
  tailwind: z.boolean().optional(),
  includeRuntime: z.boolean().optional(),
})

const svgToPngSchema = z.object({
  svg: z.string().min(10).max(4_000_000),
  width: z.number().min(32).max(4096).optional(),
  height: z.number().min(32).max(4096).optional(),
  scale: z.number().min(1).max(3).optional(),
  padding: z.number().min(0).max(96).optional(),
  background: z.string().max(64).optional(),
  fontFamily: z.string().max(256).optional(),
})

const fileReadSchema = z.object({
  filePath: z.string().min(1).max(2048),
  workspaceRoot: z.string().max(2048).nullable().optional(),
  mode: z.enum(['auto', 'text', 'image']).optional(),
})

const fileWatchSchema = z.object({
  watchId: z.string().min(1).max(256),
  filePath: z.string().min(1).max(2048),
  workspaceRoot: z.string().max(2048).nullable().optional(),
  mode: z.enum(['auto', 'text', 'image']).optional(),
})

const fileUnwatchSchema = z.object({
  watchId: z.string().min(1).max(256),
})

const adbEmptySchema = z.object({}).optional()

const adbStartStreamSchema = z.object({
  serial: z.string().min(1).max(128),
  intervalMs: z.number().min(180).max(3000).optional(),
})

const adbStopStreamSchema = z.object({
  serial: z.string().min(1).max(128),
})

const adbInputSchema = z.discriminatedUnion('action', [
  z.object({
    serial: z.string().min(1).max(128),
    action: z.literal('tap'),
    x: z.number().min(0).max(20_000),
    y: z.number().min(0).max(20_000),
  }),
  z.object({
    serial: z.string().min(1).max(128),
    action: z.literal('swipe'),
    x1: z.number().min(0).max(20_000),
    y1: z.number().min(0).max(20_000),
    x2: z.number().min(0).max(20_000),
    y2: z.number().min(0).max(20_000),
    durationMs: z.number().min(50).max(3000).optional(),
  }),
  z.object({
    serial: z.string().min(1).max(128),
    action: z.literal('keyevent'),
    keyCode: z.string().min(1).max(64),
  }),
  z.object({
    serial: z.string().min(1).max(128),
    action: z.literal('text'),
    text: z.string().min(1).max(512),
  }),
  z.object({
    serial: z.string().min(1).max(128),
    action: z.literal('capture'),
  }),
])

let quitHooked = false

export function registerCanvasHandlers(): void {
  if (!quitHooked) {
    quitHooked = true
    app.once('before-quit', () => {
      stopAllAdbStreams()
      unwatchAllCanvasFiles()
    })
  }

  registerHandlerWithSchema('ipc:canvas.toolResponse', toolResponseSchema, async (req) => {
    resolveCanvasToolFromRenderer(req.callId, {
      content: req.content,
      isError: req.isError,
    })
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:canvas.captureSurface', captureSurfaceSchema, async (req) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return { ok: false, error: 'window_unavailable' }
    try {
      const zFactor = win.webContents.getZoomFactor() || 1
      const clip = {
        x: Math.max(0, Math.floor(req.rect.x * zFactor)),
        y: Math.max(0, Math.floor(req.rect.y * zFactor)),
        width: Math.max(16, Math.ceil(req.rect.width * zFactor)),
        height: Math.max(16, Math.ceil(req.rect.height * zFactor)),
      }
      let img = await win.webContents.capturePage(clip)
      if (img.isEmpty()) return { ok: false, error: 'empty_capture' }
      const maxWidth = req.maxWidth ?? 1024
      if (img.getSize().width > maxWidth) {
        img = img.resize({ width: maxWidth, quality: 'good' })
      }
      const jpeg = img.toJPEG(78)
      const size = img.getSize()
      return {
        ok: true,
        data: jpeg.toString('base64'),
        mimeType: 'image/jpeg',
        width: size.width,
        height: size.height,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  registerHandlerWithSchema('ipc:canvas.prototype.compile', prototypeCompileSchema, async (req) => {
    const { compilePrototype } = await import('../../canvas/prototype-compiler')
    return compilePrototype(req)
  })

  registerHandlerWithSchema('ipc:canvas.svgToPng', svgToPngSchema, async (req) => {
    return exportSvgToPng(req)
  })

  registerHandlerWithSchema('ipc:canvas.file.read', fileReadSchema, async (req) => {
    return readCanvasFile({
      filePath: req.filePath,
      workspaceRoot: req.workspaceRoot,
      mode: req.mode,
    })
  })

  registerHandlerWithSchema('ipc:canvas.file.watch', fileWatchSchema, async (req) => {
    return watchCanvasFile({
      watchId: req.watchId,
      filePath: req.filePath,
      workspaceRoot: req.workspaceRoot,
      mode: req.mode,
    })
  })

  registerHandlerWithSchema('ipc:canvas.file.unwatch', fileUnwatchSchema, async (req) => {
    return { ok: unwatchCanvasFile(req.watchId) }
  })

  registerHandlerWithSchema('ipc:canvas.adb.listDevices', adbEmptySchema, async () => {
    return listAdbDevices()
  })

  registerHandlerWithSchema('ipc:canvas.adb.startStream', adbStartStreamSchema, async (req) => {
    return startAdbStream(req.serial, req.intervalMs)
  })

  registerHandlerWithSchema('ipc:canvas.adb.stopStream', adbStopStreamSchema, async (req) => {
    return { ok: stopAdbStream(req.serial) }
  })

  registerHandlerWithSchema('ipc:canvas.adb.input', adbInputSchema, async (req) => {
    return sendAdbInput(req)
  })
}
