import { useSyncExternalStore } from 'react'
import { ImageLightbox } from './image-lightbox'
import { closeImagePreview, getImagePreview, subscribeImagePreview } from './image-preview-store'

/** The single mount point for image previews. */
export function ImagePreviewHost() {
  const preview = useSyncExternalStore(subscribeImagePreview, getImagePreview, getImagePreview)
  return <ImageLightbox src={preview?.src ?? null} alt={preview?.alt} onClose={closeImagePreview} />
}

export function useImagePreview() {
  return useSyncExternalStore(subscribeImagePreview, getImagePreview, getImagePreview)
}
