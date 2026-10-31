import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import { ImageLightbox } from '@renderer/components/ui/image-lightbox'

/**
 * Pasted images are referenced by their temp file path, so the bubble needs the bytes back to show
 * the picture. `null` means unreadable (pruned after 7 days, or removed) and stays cached that way.
 */
const dataUrlCache = new Map<string, string | null>()

type ReadResponse = { ok: true; dataUrl: string } | { ok: false; error: string }

export function ClipboardImageChip({ path, name, className }: { path: string; name: string; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => dataUrlCache.get(path) ?? null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (dataUrlCache.has(path)) {
      setDataUrl(dataUrlCache.get(path) ?? null)
      return
    }
    let alive = true
    void ipcClient
      .invoke('clipboard.readTempImage', { path })
      .then((res: ReadResponse) => {
        const url = res?.ok ? res.dataUrl : null
        dataUrlCache.set(path, url)
        if (alive) setDataUrl(url)
      })
      .catch(() => dataUrlCache.set(path, null))
    return () => {
      alive = false
    }
  }, [path])

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
