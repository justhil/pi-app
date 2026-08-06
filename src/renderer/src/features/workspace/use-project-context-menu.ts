import { useState } from 'react'

type MenuState = { x: number; y: number; path: string; name: string; hasArchivable: boolean } | null

export function useProjectContextMenu(onListChange: (path?: string) => void) {
  const [menu, setMenu] = useState<MenuState>(null)

  const open = (e: React.MouseEvent, path: string, name: string, hasArchivable: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path, name, hasArchivable })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}