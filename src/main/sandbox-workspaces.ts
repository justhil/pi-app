import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const META_FILE = '.pi-desktop-sandbox.json'

export interface SandboxMeta {
  id: string
  label: string
  createdAt: number
  kind: 'sandbox'
}

export function getSandboxRoot(): string {
  return join(app.getPath('userData'), 'sandbox-workspaces')
}

export function isSandboxWorkspacePath(path: string): boolean {
  if (!path) return false
  const root = getSandboxRoot()
  const norm = path.replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/')
  return norm === rootNorm || norm.startsWith(rootNorm + '/')
}

function readMeta(dir: string): SandboxMeta | null {
  const p = join(dir, META_FILE)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SandboxMeta
  } catch {
    return null
  }
}

export function ensureSandboxRoot(): string {
  const root = getSandboxRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

export function createSandboxWorkspace(label?: string): { id: string; path: string; label: string; createdAt: number } {
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

export function listSandboxWorkspaces(): Array<{ id: string; path: string; label: string; createdAt: number }> {
  const root = ensureSandboxRoot()
  const out: Array<{ id: string; path: string; label: string; createdAt: number }> = []
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = join(root, name.name)
    const meta = readMeta(dir)
    if (meta) {
      out.push({ id: meta.id, path: dir, label: meta.label, createdAt: meta.createdAt })
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

export function deleteSandboxWorkspace(path: string): boolean {
  if (!isSandboxWorkspacePath(path)) return false
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}