import { session } from 'electron'
import { z } from 'zod'
import { DEFAULT_ELECTRON_PROFILE_ID } from '@shared/browser-types'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { getMainWindow } from '../../window'
import { getBrowserHost, peekBrowserHost } from '../../browser/browser-host'
import { partitionForProfile } from '../../browser/electron-session'

const tabId = z.string().min(1).max(64)
const profileId = z.string().regex(/^[a-z0-9-]{1,48}$/)
const host = () => getBrowserHost(getMainWindow)

export function registerBrowserHandlers(): void {
  registerHandler('ipc:browser.tabs.list', async () => peekBrowserHost()?.list() ?? { tabs: [], activeTabId: null })

  registerHandlerWithSchema(
    'ipc:browser.tabs.open',
    z.object({ url: z.string().max(8192).optional(), profileId: profileId.optional() }),
    async (req) => ({ tab: host().openTab(req) }),
  )

  registerHandlerWithSchema('ipc:browser.tabs.close', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.closeTab(req.tabId)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.tabs.focus', z.object({ tabId }), async (req) => {
    peekBrowserHost()?.focusTab(req.tabId)
    return { ok: true }
  })

  registerHandlerWithSchema(
    'ipc:browser.navigate',
    z.union([
      z.object({ tabId, url: z.string().min(1).max(8192) }),
      z.object({ tabId, history: z.enum(['back', 'forward', 'reload', 'stop']) }),
    ]),
    async (req) => {
      const { tabId: id, ...op } = req
      await host().navigate(id, op)
      return { ok: true }
    },
  )

  registerHandlerWithSchema(
    'ipc:browser.viewBounds',
    z.object({
      tabId,
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
      visible: z.boolean(),
    }),
    async (req) => {
      peekBrowserHost()?.setViewBounds(req)
      return { ok: true }
    },
  )

  registerHandler('ipc:browser.hideAll', async () => {
    peekBrowserHost()?.hideAll()
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:browser.capture', z.object({ tabId }), async (req) => ({
    dataUrl: (await peekBrowserHost()?.capture(req.tabId)) ?? null,
  }))

  registerHandler('ipc:browser.shutdown', async () => {
    peekBrowserHost()?.shutdown()
    return { ok: true }
  })

  registerHandlerWithSchema(
    'ipc:browser.profile.clear',
    z.object({ profileId: profileId.optional() }),
    async (req) => {
      const ses = session.fromPartition(partitionForProfile(req.profileId ?? DEFAULT_ELECTRON_PROFILE_ID))
      await ses.clearStorageData()
      await ses.clearCache()
      return { ok: true }
    },
  )
}
