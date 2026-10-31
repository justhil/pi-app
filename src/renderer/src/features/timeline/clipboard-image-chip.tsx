import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import { ImageLightbox } from '@renderer/components/ui/image-lightbox'

/**
 * Pasted images are referenced by their temp file path, so the bubble needs the bytes back to show
 * the picture. `null` means unreadable (pruned after 7 days, or removed) and stays cached that way.
 */
const dataUrlCache = new Map<string, string | null>()

export function rememberImagePreviewDataUrl(path: string, dataUrl: string): void {
  if (!path || !dataUrl) return
  dataUrlCache.set(path, dataUrl)
}

type ReadResponse = { ok: true; dataUrl: string } | { ok: false; error: string }

export function ClipboardImageChip({ path, name, className }: { path: string; name: string; className?: string }) {
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const [dataUrl, setDataUrl] = useState<string | null>(() => dataUrlCache.get(path) ?? null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (dataUrlCache.has(path)) {
      setDataUrl(dataUrlCache.get(path) ?? null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const res = (await ipcClient.invoke('clipboard.readTempImage', { path })) as ReadResponse
        if (res?.ok && res.dataUrl) {
          dataUrlCache.set(path, res.dataUrl)
          if (alive) setDataUrl(res.dataUrl)
          return
        }
        if (currentWorkspace) {
          const wsRes = (await ipcClient.invoke('shell.readImagePreview', {
            workspaceRoot: currentWorkspace,
            path,
          })) as ReadResponse
          if (wsRes?.ok && wsRes.dataUrl) {
            dataUrlCache.set(path, wsRes.dataUrl)
            if (alive) setDataUrl(wsRes.dataUrl)
            return
          }
        }
        dataUrlCache.set(path, null)
        if (alive) setDataUrl(null)
      } catch {
        dataUrlCache.set(path, null)
        if (alive) setDataUrl(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [currentWorkspace, path])

  if (!dataUrl) {
    return <AttachmentChip attachment={{ path, name, kind: 'image' }} openable className={className} />
  }

  return (
    <>
      <AttachmentChip
        attachment={{ path, name, kind: 'image' }}
        previewSrc={dataUrl}
        onPreview={() => setPreviewOpen(true)}
        className={className}
      />
      {previewOpen && <ImageLightbox src={dataUrl} alt={name} onClose={() => setPreviewOpen(false)} />}
    </>
  )
}
