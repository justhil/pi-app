import { useEffect, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { AttachmentChip } from '@renderer/features/composer/attachment-chip'
import { openImagePreview } from '@renderer/components/ui/image-preview-store'

/**
 * Pasted images are referenced by their temp file path, so the bubble needs the bytes back to show
 * the picture. `null` means unreadable (pruned after 7 days, or removed) and stays cached that way.
 */
const dataUrlCache = new Map<string, string | null>()

type ReadResponse = { ok: true; dataUrl: string } | { ok: false; error: string }

export function ClipboardImageChip({ path, name, className }: { path: string; name: string; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => dataUrlCache.get(path) ?? null)

  useEffect(() => {
    if (dataUrlCache.has(path)) {
      setDataUrl(dataUrlCache.get(path) ?? null)
      return
    }
    let alive = true
    // The send handler stores the bytes a beat after the row appears, so a first miss is retried
    // instead of being remembered. Only a hit is cached.
    const read = (attempt: number) =>
      ipcClient
        .invoke('clipboard.readTempImage', { path })
        .then((res: ReadResponse) => {
          if (res?.ok) {
            dataUrlCache.set(path, res.dataUrl)
            if (alive) setDataUrl(res.dataUrl)
            return
          }
          if (!alive || attempt >= 3) return
          window.setTimeout(() => void read(attempt + 1), 400)
        })
        .catch(() => {
          /* transient: leave the icon chip in place */
        })
    void read(0)
    return () => {
      alive = false
    }
  }, [path])

  if (!dataUrl) {
    return <AttachmentChip attachment={{ path, name, kind: 'image' }} openable className={className} />
  }

  return (
    <AttachmentChip
      attachment={{ path, name, kind: 'image' }}
      previewSrc={dataUrl}
      onPreview={() => openImagePreview(dataUrl, name)}
      className={className}
    />
  )
}
