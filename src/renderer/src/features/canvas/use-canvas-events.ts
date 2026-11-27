import { useEffect } from 'react'
import type { CanvasFileChangedEvent } from '@shared/canvas-types'
import { onCanvasEvent } from '@renderer/lib/ipc-client'
import { handleCanvasToolCallEvent, useCanvasStore } from './canvas-store'

type FileChangeListener = (event: CanvasFileChangedEvent) => void

const fileChangeListeners = new Set<FileChangeListener>()

export function subscribeCanvasFileChanges(listener: FileChangeListener): () => void {
  fileChangeListeners.add(listener)
  return () => {
    fileChangeListeners.delete(listener)
  }
}

export function useCanvasEvents(): void {
  useEffect(() => {
    return onCanvasEvent((event) => {
      if (event.type === 'canvas-tool-call') {
        handleCanvasToolCallEvent(event)
      } else if (event.type === 'canvas-adb-frame') {
        useCanvasStore.getState().applyAdbFrame(event)
      } else if (event.type === 'canvas-adb-status') {
        useCanvasStore.getState().applyAdbStatus(event)
      } else if (event.type === 'canvas-file-changed') {
        for (const listener of fileChangeListeners) {
          listener(event)
        }
      }
    })
  }, [])
}
