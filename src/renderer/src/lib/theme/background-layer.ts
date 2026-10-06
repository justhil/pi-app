import { activeBackground, normalizeBackground, type BackgroundImage, type BackgroundSettings } from '@shared/background'
import { ipcClient } from '@renderer/lib/ipc-client'

const LAYER_ID = 'pi-background'
/** blob: URLs per stored file; images are small in number and reused across light / dark. */
const urls = new Map<string, Promise<string | null>>()
let current: BackgroundSettings = { shared: true }
let observer: MutationObserver | null = null
let shown: string | null = null

function imageUrl(file: string): Promise<string | null> {
  let p = urls.get(file)
  if (!p) {
    p = ipcClient
      .invoke('background.read', { file })
      .then((r: { ok: boolean; data?: Uint8Array; mime?: string }) => (r?.ok && r.data ? URL.createObjectURL(new Blob([r.data as BlobPart], { type: r.mime })) : null))
      .catch(() => null)
    urls.set(file, p)
  }
  return p
}

function layer(): HTMLDivElement {
  let el = document.getElementById(LAYER_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = LAYER_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.prepend(el)
  }
  return el
}

const SIZE: Record<BackgroundImage['fit'], string> = { cover: 'cover', contain: 'contain', tile: 'auto', center: 'auto' }

function render(): void {
  const root = document.documentElement
  const img = activeBackground(current, root.classList.contains('dark'))
  if (!img) {
    root.removeAttribute('data-bg')
    root.style.removeProperty('--ui-alpha')
    document.getElementById(LAYER_ID)?.remove()
    shown = null
    return
  }
  const el = layer()
  el.style.backgroundSize = SIZE[img.fit]
  el.style.backgroundRepeat = img.fit === 'tile' ? 'repeat' : 'no-repeat'
  el.style.backgroundPosition = img.fit === 'cover' ? `center ${img.position}` : 'center'
  el.style.filter = img.blur ? `blur(${img.blur}px)` : ''
  // A blurred edge would show the window colour: grow the layer past the viewport by the blur radius.
  el.style.inset = img.blur ? `-${img.blur * 2}px` : '0'
  el.style.setProperty('--bg-image-opacity', String(img.opacity))
  root.style.setProperty('--ui-alpha', String(img.uiOpacity))
  root.setAttribute('data-bg', 'on')
  if (shown === img.file) return
  shown = img.file
  el.classList.remove('is-loaded')
  void imageUrl(img.file).then((url) => {
    if (shown !== img.file || !url) return
    el.style.backgroundImage = `url("${url}")`
    // Fade in once decoded, so startup shows the plain theme first rather than a half-drawn image.
    requestAnimationFrame(() => el.classList.add('is-loaded'))
  })
}

/** Show (or remove) the background for `settings`; follows light / dark switches by itself. */
export function applyBackground(settings: BackgroundSettings): void {
  current = settings
  if (!observer) {
    observer = new MutationObserver(render)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  render()
}

export async function hydrateBackgroundFromSettings(): Promise<void> {
  const res = await ipcClient.invoke('settings.get', { key: 'background' }).catch(() => ({ settings: {} }))
  applyBackground(normalizeBackground(res?.settings?.background))
}

/** Preview URL for the settings page thumbnails. */
export function backgroundPreviewUrl(file: string): Promise<string | null> {
  return imageUrl(file)
}
