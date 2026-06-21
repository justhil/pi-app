import { useEffect, useRef } from 'react'
import { registerSettingsDirtySlice } from '@renderer/features/settings/settings-dirty-registry'

type SliceInput = {
  id: string
  label?: string
  isDirty: () => boolean
  commit: () => Promise<void>
  discard: () => void | Promise<void>
}

/** 子页注册脏状态；ref 持有最新回调，避免频繁重注册 */
export function useSettingsDirtySlice(slice: SliceInput): void {
  const ref = useRef(slice)
  ref.current = slice

  useEffect(() => {
    return registerSettingsDirtySlice({
      id: slice.id,
      label: slice.label,
      isDirty: () => ref.current.isDirty(),
      commit: () => ref.current.commit(),
      discard: () => ref.current.discard(),
    })
  }, [slice.id])
}