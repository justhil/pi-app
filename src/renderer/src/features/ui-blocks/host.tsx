import { lazy, memo, Suspense } from 'react'
import { peekComponentName, peekItemCount } from './protocol'
import { skeletonKindFor, UIBlockSkeleton } from './skeleton'
import './ui-blocks-base.css'

const UIBlockRuntime = lazy(() => import('./runtime'))

/**
 * Entry point used by the Markdown renderer and Canvas UiBlockSurface.
 * Memoized so upstream settled blocks never re-render while subsequent prose streams in.
 */
export const UIBlockHost = memo(function UIBlockHost({
  raw,
  streaming,
  inCanvas = false,
}: {
  raw: string
  streaming: boolean
  inCanvas?: boolean
}) {
  return (
    <Suspense
      fallback={<UIBlockSkeleton kind={skeletonKindFor(peekComponentName(raw))} items={peekItemCount(raw)} />}
    >
      <UIBlockRuntime raw={raw} streaming={streaming} inCanvas={inCanvas} />
    </Suspense>
  )
})
