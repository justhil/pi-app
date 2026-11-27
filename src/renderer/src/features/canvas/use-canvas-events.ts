import { useEffect } from 'react'
import { onCanvasEvent } from '@renderer/lib/ipc-client'
import { handleCanvasToolCallEvent } from './canvas-store'

export function useCanvasEvents(): void {
  useEffect(() => {
    return onCanvasEvent((event) => {
      if (event.type === 'canvas-tool-call') {
        handleCanvasToolCallEvent(event)
      }
    })
  }, [])
}
