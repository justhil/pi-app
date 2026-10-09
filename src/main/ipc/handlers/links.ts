import { shell } from 'electron'
import { z } from 'zod'
import { getLinkPreview, isWebLink } from '../../link-preview'
import { registerHandlerWithSchema } from '../registry'

const webLinkSchema = z.object({ url: z.string().min(1).max(8192).refine(isWebLink) })

export function registerLinkHandlers(): void {
  registerHandlerWithSchema('ipc:link.preview', webLinkSchema, async ({ url }) => getLinkPreview(url))
  registerHandlerWithSchema('ipc:shell.openExternal', webLinkSchema, async ({ url }) => {
    await shell.openExternal(url)
    return { ok: true }
  })
}
