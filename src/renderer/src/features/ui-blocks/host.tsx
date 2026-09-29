import { lazy, Suspense } from 'react'
import { peekComponentName, peekItemCount } from './protocol'
import { skeletonKindFor, UIBlockSkeleton } from './skeleton'
import './ui-blocks-base.css'

const UIBlockRuntime = lazy(() => import('./runtime'))

/**
 * Entry point used by the Markdown renderer. Parser, components and their CSS live in a lazy
 * chunk, so conversations without pi-ui blocks never download or evaluate them.
 */
export function UIBlockHost({ raw, streaming }: { raw: string; streaming: boolean }) {
  return (
    <Suspense
      fallback={<UIBlockSkeleton kind={skeletonKindFor(peekComponentName(raw))} items={peekItemCount(raw)} />}
    >
      <UIBlockRuntime raw={raw} streaming={streaming} />
    </Suspense>
  )
}
