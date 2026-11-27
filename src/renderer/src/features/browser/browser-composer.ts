import { ipcClient } from '@renderer/lib/ipc-client'
import { getAttachmentKind } from '@renderer/features/composer/attachments'
import { capabilityKey, setSessionCapability, useSessionCapabilitiesStore } from '@renderer/lib/session-capabilities'
import { useUIStore } from '@renderer/stores/ui-store'

export interface ComposerFile {
  path: string
  name: string
}

/**
 * Hand browser content to the composer as editable text and/or attachment chips.
 * Keeps split-view open (5:5 / 7:3) so the user can keep reading side-by-side;
 * only steps down from Full stage to 5:5 split so Composer is immediately visible.
 */
export function sendToComposer(payload: { text?: string; files?: ComposerFile[] }): void {
  const ui = useUIStore.getState()
  if (ui.browserChatExpand) {
    useUIStore.setState({ browserChatExpand: false })
  }
  const key = capabilityKey(ui.historySessionFile)
  const currentCaps = useSessionCapabilitiesStore.getState().byKey[key] ?? []
  if (!currentCaps.includes('browser') && !currentCaps.includes('chrome')) {
    setSessionCapability(ui.historySessionFile, 'browser', true)
  }
  window.dispatchEvent(
    new CustomEvent('pi-desktop:composer-attach-files', {
      detail: {
        text: payload.text,
        files: (payload.files ?? []).map((f) => ({ ...f, kind: getAttachmentKind(f.name) })),
      },
    }),
  )
}

/** Store a data URL image as a temp attachment file and return it as a composer file. */
export async function saveImageAttachment(dataUrl: string, name: string): Promise<ComposerFile> {
  const match = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(dataUrl)
  if (!match) throw new Error('not an image data URL')
  const { path } = (await ipcClient.invoke('clipboard.writeTempImage', {
    data: match[2],
    mimeType: match[1],
  })) as { path: string }
  return { path, name }
}
