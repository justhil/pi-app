export type GitWorktree = {
  path: string
  branch?: string
  isMain: boolean
  detached: boolean
}

export type GitWorktreeList = {
  ok: boolean
  repositoryPath: string | null
  trees: GitWorktree[]
  missing?: boolean
  error?: string
}
