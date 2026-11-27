import { create } from 'zustand'

export type DraftWorktreeMode = 'local' | 'new-worktree' | 'existing-worktree'

export interface DraftWorktreeState {
  mode: DraftWorktreeMode
  branchName: string
  baseBranch: string | null
  fromOrigin: boolean
  existingWorktreePath: string | null
  setMode: (mode: DraftWorktreeMode) => void
  setBranchName: (name: string) => void
  setBaseBranch: (branch: string | null) => void
  setFromOrigin: (fromOrigin: boolean) => void
  setExistingWorktreePath: (path: string | null) => void
  reset: () => void
}

export function slugifyWorktreeBranchFromPrompt(prompt: string): string {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
  const suffix = Math.random().toString(36).slice(2, 6)
  return ascii ? `wt/${ascii}-${suffix}` : `wt/task-${suffix}`
}

export const useDraftWorktreeStore = create<DraftWorktreeState>((set) => ({
  mode: 'local',
  branchName: '',
  baseBranch: null,
  fromOrigin: false,
  existingWorktreePath: null,
  setMode: (mode) => set({ mode }),
  setBranchName: (branchName) => set({ branchName }),
  setBaseBranch: (baseBranch) => set({ baseBranch }),
  setFromOrigin: (fromOrigin) => set({ fromOrigin }),
  setExistingWorktreePath: (existingWorktreePath) => set({ existingWorktreePath }),
  reset: () =>
    set({
      mode: 'local',
      branchName: '',
      baseBranch: null,
      fromOrigin: false,
      existingWorktreePath: null,
    }),
}))
