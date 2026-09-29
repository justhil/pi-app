import type { ComponentType } from 'react'
import type { Validator } from './schema'

export type UIBlockComponentProps<P> = {
  props: P
  /** Stable identity (component + id + content hash) for interaction state. */
  blockKey: string
  /** True only the first time a block completes during a live answer. */
  animate: boolean
}

export type SkeletonKind = 'chart' | 'cards' | 'rows' | 'block'

export type UIBlockDefinition<P = unknown> = {
  name: string
  schema: Validator<P>
  Component: ComponentType<UIBlockComponentProps<P>>
  skeleton: SkeletonKind
}
