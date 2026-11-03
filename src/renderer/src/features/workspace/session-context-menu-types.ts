export type SessionMenuFork = {
  sessionId: string
  sessionFile: string
  title: string
}

export type SessionMenuTarget = {
  sessionId: string
  sessionFile?: string
  title: string
  workspacePath: string
  /** Sessions forked from this one, listed under the menu's fork submenu. */
  forks?: SessionMenuFork[]
}
