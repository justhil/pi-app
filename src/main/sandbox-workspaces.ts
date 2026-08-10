import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolveActiveDesktopDir } from './agent-dir'
import { isWslRuntimeActive } from './wsl/runtime-config'

const META_FILE = '.pi-desktop-sandbox.json'

export interface SandboxMeta {
  id: string
  label: string
  createdAt: number
  kind: 'sandbox'
  sessionId?: string
  sessionFile?: string
}

export function getSandboxRoot(): string {
  // WSL 模式下 sandbox 工作区建在发行版内（~/.pi/desktop/sandbox-workspaces，
  // UNC 视图），避免 WSL worker 通过 /mnt/c 访问 Windows 宿主目录。
  if (isWslRuntimeActive()) {
    return join(resolveActiveDesktopDir(), 'sandbox-workspaces')
  }
  return join(app.getPath('userData'), 'sandbox-workspaces')
}

function legacySandboxRoot(): string {
  return join(app.getPath('userData'), 'sandbox-workspaces')
}

export function isSandboxWorkspacePath(path: string): boolean {
  if (!path) return false
  const norm = path.replace(/\\/g, '/')
  // 同时识别迁移前的 userData sandbox（宿主模式下两者一致）。
  for (const root of [getSandboxRoot(), legacySandboxRoot()]) {
    const rootNorm = root.replace(/\\/g, '/')
    if (norm === rootNorm || norm.startsWith(rootNorm + '/')) return true
  }
  return false
}

function readMeta(dir: string): SandboxMeta | null {
  const p = join(dir, META_FILE)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SandboxMeta
  } catch (e) {
    return null
  }
}

export function ensureSandboxRoot(): string {
  const root = getSandboxRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

export function createSandboxWorkspace(label?: string): {
  id: string
  path: string
  label: string
  createdAt: number
  sessionId?: string
  sessionFile?: string
} {
  const root = ensureSandboxRoot()
  const id = randomUUID().slice(0, 8)
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const meta: SandboxMeta = {
    id,
    label: label?.trim() || `临时对话 ${id}`,
    createdAt: Date.now(),
    kind: 'sandbox',
  }
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf-8')
  return { id, path: dir, label: meta.label, createdAt: meta.createdAt }
}

export function listSandboxWorkspaces(): Array<{
  id: string
  path: string
  label: string
  createdAt: number
  sessionId?: string
  sessionFile?: string
}> {
  const root = ensureSandboxRoot()
  const out: Array<{
    id: string
    path: string
    label: string
    createdAt: number
    sessionId?: string
    sessionFile?: string
  }> = []
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = join(root, name.name)
    const meta = readMeta(dir)
    if (meta) {
      out.push({
        id: meta.id,
        path: dir,
        label: meta.label,
        createdAt: meta.createdAt,
        sessionId: meta.sessionId,
        sessionFile: meta.sessionFile,
      })
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

export function renameSandboxWorkspace(path: string, label: string): boolean {
  if (!isSandboxWorkspacePath(path)) return false
  const meta = readMeta(path)
  if (!meta) return false
  meta.label = label.trim() || meta.label
  writeFileSync(join(path, META_FILE), JSON.stringify(meta, null, 2), 'utf-8')
  return true
}

export function bindSandboxSession(path: string, sessionId: string, sessionFile?: string): boolean {
  if (!sessionId || !isSandboxWorkspacePath(path)) return false
  const meta = readMeta(path)
  if (!meta) return false
  meta.sessionId = sessionId
  if (sessionFile) meta.sessionFile = sessionFile
  writeFileSync(join(path, META_FILE), JSON.stringify(meta, null, 2), 'utf-8')
  return true
}
export function deleteSandboxWorkspace(path: string): boolean {
  if (!isSandboxWorkspacePath(path)) return false
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch (e) {
    return false
  }
}