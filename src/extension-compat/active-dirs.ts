// 活动用户目录解析（共享：main / worker / renderer 均可打包）。
// main 在启动时通过 setActiveDirResolvers 注入 WSL 感知的解析器；
// worker 未注入时回退到 homedir()（WSL 内即发行版 home，天然正确）。
import { homedir } from 'os'
import { join } from 'path'

export type DirResolver = () => string

let agentDirResolver: DirResolver = () => join(homedir(), '.pi', 'agent')
let desktopDirResolver: DirResolver = () => join(homedir(), '.pi', 'desktop')
let homeDirResolver: DirResolver = () => homedir()

export function setActiveDirResolvers(resolvers: {
  agentDir?: DirResolver
  desktopDir?: DirResolver
  homeDir?: DirResolver
}): void {
  if (resolvers.agentDir) agentDirResolver = resolvers.agentDir
  if (resolvers.desktopDir) desktopDirResolver = resolvers.desktopDir
  if (resolvers.homeDir) homeDirResolver = resolvers.homeDir
}

export function getActiveAgentDir(): string {
  return agentDirResolver()
}

export function getActiveDesktopDir(): string {
  return desktopDirResolver()
}

export function getActiveHomeDir(): string {
  return homeDirResolver()
}
