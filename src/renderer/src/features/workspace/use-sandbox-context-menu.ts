import { useState } from 'react'
import type { SandboxEntry } from './project-sidebar-types'

export type SandboxMenuTarget = SandboxEntry

type MenuState = { x: number; y: number; target: SandboxMenuTarget } | null

export function useSandboxContextMenu(onListChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, target: SandboxMenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}
