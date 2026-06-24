import { useState } from 'react'

type MenuState = { x: number; y: number; path: string; name: string } | null

export function useProjectContextMenu(onListChange: () => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path, name })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}