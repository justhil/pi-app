import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, CloudDownload, ExternalLink, X } from '@renderer/components/icons'
import { BlockFrame } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'

export type GalleryImage = {
  src: string
  alt?: string
  caption?: string
  source?: string
  url?: string
}

type ImageGalleryProps = {
  title?: string
  images: GalleryImage[]
}

export function safeBlockImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,/i.test(trimmed)) return trimmed
  return undefined
}

export function safeBlockLinkUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
}: {
  images: readonly GalleryImage[]
  index: number | null
  onIndexChange: (next: number | null) => void
}) {
  useEffect(() => {
    if (index === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onIndexChange(null)
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        onIndexChange((index - 1 + images.length) % images.length)
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        onIndexChange((index + 1) % images.length)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [images.length, index, onIndexChange])

  if (index === null || !images[index] || typeof document === 'undefined') return null
  const current = images[index]
  const href = safeBlockLinkUrl(current.url)

  return createPortal(
    <div
      className="uib-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || current.caption || '图片预览'}
      onClick={() => onIndexChange(null)}
    >
      <div className="uib-lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="uib-lightbox-top">
          <span className="uib-lightbox-counter">
            {images.length > 1 ? `${index + 1} / ${images.length}` : ''}
            {current.source ? ` · ${current.source}` : ''}
          </span>
          <div className="uib-lightbox-actions">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="uib-lightbox-btn" title="打开来源">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <a href={current.src} download={current.alt || 'image.png'} className="uib-lightbox-btn" title="下载图片">
              <CloudDownload className="h-3.5 w-3.5" />
            </a>
            <button type="button" onClick={() => onIndexChange(null)} className="uib-lightbox-btn" aria-label="关闭预览">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="uib-lightbox-stage">
          {images.length > 1 ? (
            <button
              type="button"
              onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
              className="uib-lightbox-nav"
              aria-label="上一张"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
          <img src={current.src} alt={current.alt || current.caption || ''} className="uib-lightbox-img" />
          {images.length > 1 ? (
            <button
              type="button"
              onClick={() => onIndexChange((index + 1) % images.length)}
              className="uib-lightbox-nav"
              aria-label="下一张"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {current.caption ? <p className="uib-lightbox-caption">{current.caption}</p> : null}
      </div>
    </div>,
    document.body,
  )
}

const schema = v.object<ImageGalleryProps>({
  title: v.optional(v.string()),
  images: v.array(
    v.object<GalleryImage>({
      src: v.string(),
      alt: v.optional(v.string()),
      caption: v.optional(v.string()),
      source: v.optional(v.string()),
      url: v.optional(v.string()),
    }),
    { min: 1, max: 30 },
  ),
})

function GalleryTile({
  image,
  single,
  onOpen,
}: {
  image: GalleryImage
  single: boolean
  onOpen: () => void
}) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return (
    <figure className="uib-gallery-item">
      <button
        type="button"
        onClick={onOpen}
        className={single ? 'uib-gallery-thumb uib-gallery-thumb-single' : 'uib-gallery-thumb'}
      >
        <img
          src={image.src}
          alt={image.alt || image.caption || ''}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </button>
      {image.caption || image.source ? (
        <figcaption className="uib-gallery-cap">
          {image.caption ? <div className="uib-gallery-cap-text">{image.caption}</div> : null}
          {image.source ? <div className="uib-gallery-cap-src">{image.source}</div> : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

function ImageGallery({ props, animate }: UIBlockComponentProps<ImageGalleryProps>) {
  const images = useMemo(
    () =>
      props.images.flatMap((img) => {
        const src = safeBlockImageUrl(img.src)
        return src ? [{ ...img, src }] : []
      }),
    [props.images],
  )
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const cols = images.length === 1 ? 1 : images.length === 2 ? 2 : 3

  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={images.length > 1 ? <span className="uib-muted">{images.length} 张</span> : null}
    >
      {images.length === 0 ? (
        <div className="uib-empty">暂无可用图片</div>
      ) : (
        <div className="uib-gallery-grid" data-cols={cols}>
          {images.map((image, idx) => (
            <GalleryTile
              key={`${idx}-${image.src.slice(0, 48)}`}
              image={image}
              single={images.length === 1}
              onOpen={() => setOpenIndex(idx)}
            />
          ))}
        </div>
      )}
      <ImageLightbox images={images} index={openIndex} onIndexChange={setOpenIndex} />
    </BlockFrame>
  )
}

export const imageGalleryDefinition: UIBlockDefinition<ImageGalleryProps> = {
  name: 'image-gallery',
  schema,
  Component: ImageGallery,
  skeleton: 'cards',
}
