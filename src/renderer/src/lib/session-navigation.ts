/** 会话/工作区切换代数，快切时丢弃过期的异步结果 */
let generation = 0

export function beginSessionNavigation(): number {
  return ++generation
}

export function isSessionNavigationCurrent(token: number): boolean {
  return token === generation
}

export function assertSessionNavigation(token: number): boolean {
  if (!isSessionNavigationCurrent(token)) return false
  return true
}