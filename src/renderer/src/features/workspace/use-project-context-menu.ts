import { useState } from 'react'

export type ProjectMenuOptions = {
  isRepositoryGroup?: boolean
  repositoryPath?: string
  isSecondaryWorktree?: boolean
  groupPaths?: string[]
  siblingPaths?: string[]
}

export type ProjectMenuTarget = {
  path: string
  name: string
  isRepositoryGroup?: boolean
  repositoryPath?: string
  isSecondaryWorktree?: boolean
  groupPaths?: string[]
  siblingPaths?: string[]
}

export type ProjectMenuState = ({ x: number; y: number } & ProjectMenuTarget) | null

export function useProjectContextMenu(onListChange: () => void) {
  const [menu, setMenu] = useState<ProjectMenuState>(null)

  const open = (e: React.MouseEvent, path: string, name: string, options?: ProjectMenuOptions) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      path,
      name,
      isRepositoryGroup: options?.isRepositoryGroup,
      repositoryPath: options?.repositoryPath,
      isSecondaryWorktree: options?.isSecondaryWorktree,
      groupPaths: options?.groupPaths,
      siblingPaths: options?.siblingPaths,
    })
  }

  const close = () => setMenu(null)

  return { menu, open, close, onListChange }
}
