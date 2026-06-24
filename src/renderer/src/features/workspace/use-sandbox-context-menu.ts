import { useState } from 'react'

type MenuState = { x: number; y: number; path: string; label: string } | null

export function useSandboxContextMenu(onListChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, path: string, label: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path, label })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}