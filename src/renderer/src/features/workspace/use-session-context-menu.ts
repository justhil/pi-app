import { useState } from 'react'
import type { SessionMenuTarget } from './session-context-menu-types'

type MenuState = { x: number; y: number; target: SessionMenuTarget } | null

export function useSessionContextMenu(onSessionsChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, target: SessionMenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onSessionsChange }
}