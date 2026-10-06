import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'

export type ShellProfile = {
  id: string
  name: string
  path: string
  args: string[]
  kind: 'bash' | 'zsh' | 'fish' | 'pwsh' | 'powershell' | 'cmd' | 'wsl' | 'sh' | 'other'
  /** The shell pi itself runs commands with (its `shellPath` / Git Bash / /bin/bash). */
  piDefault?: boolean
}

type Env = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; exists: (p: string) => boolean; realpath?: (p: string) => string; which: (exe: string) => string | null; wslDistros: () => string[]; etcShells: () => string[] }

/** Last path segment for either separator (profiles are also built for Windows paths in tests). */
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

function kindOf(path: string): ShellProfile['kind'] {
  const b = basename(path).toLowerCase().replace(/\.exe$/, '')
  if (b === 'bash') return 'bash'
  if (b === 'zsh') return 'zsh'
  if (b === 'fish') return 'fish'
  if (b === 'pwsh') return 'pwsh'
  if (b === 'powershell') return 'powershell'
  if (b === 'cmd') return 'cmd'
  if (b === 'wsl') return 'wsl'
  if (b === 'sh' || b === 'dash') return 'sh'
  return 'other'
}

/** Interactive arguments: login shells, so profile files (PATH, prompt) load like in a real terminal. */
function interactiveArgs(kind: ShellProfile['kind'], platform: NodeJS.Platform): string[] {
  if (kind === 'bash') return platform === 'win32' ? ['--login', '-i'] : ['-l']
  if (kind === 'zsh' || kind === 'fish' || kind === 'sh') return ['-l']
  if (kind === 'pwsh' || kind === 'powershell') return ['-NoLogo']
  return []
}

const NAMES: Partial<Record<ShellProfile['kind'], string>> = { bash: 'bash', zsh: 'zsh', fish: 'fish', sh: 'sh', pwsh: 'PowerShell 7', powershell: 'Windows PowerShell', cmd: 'Command Prompt' }

/**
 * Shells a terminal tab can open. The first is the default: the shell pi runs its own commands
 * with (`piShell`, from pi's `getShellConfig`), so the terminal and the agent see the same shell.
 */
export function detectProfiles(piShell: string | null, e: Env = realEnv()): ShellProfile[] {
  const out: ShellProfile[] = []
  const seen = new Set<string>()
  const add = (path: string | null | undefined, extra: Partial<ShellProfile> = {}) => {
    if (!path || !e.exists(path)) return
    // /bin is a symlink to /usr/bin on merged-usr systems: one entry per real binary.
    const real = e.realpath?.(path) ?? path
    const key = e.platform === 'win32' ? real.toLowerCase() : real
    if (seen.has(key)) return
    seen.add(key)
    const kind = kindOf(path)
    const gitBash = e.platform === 'win32' && kind === 'bash' && /\\git\\/i.test(path)
    out.push({
      id: `${kind}:${path}`,
      name: gitBash ? 'Git Bash' : NAMES[kind] ?? basename(path),
      path,
      args: interactiveArgs(kind, e.platform),
      kind,
      ...extra,
    })
  }

  add(piShell, { piDefault: true })
  if (e.platform === 'win32') {
    add(e.which('pwsh.exe'))
    const root = e.env.SystemRoot || 'C:\\Windows'
    add(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`)
    add(e.env.ComSpec || `${root}\\System32\\cmd.exe`)
    const wsl = `${root}\\System32\\wsl.exe`
    if (e.exists(wsl)) {
      for (const d of e.wslDistros()) {
        out.push({ id: `wsl:${d}`, name: `WSL · ${d}`, path: wsl, args: ['-d', d, '--cd', '~'], kind: 'wsl' })
      }
    }
  } else {
    add(e.env.SHELL)
    for (const s of e.etcShells()) if (/\/(bash|zsh|fish)$/.test(s)) add(s)
    for (const s of ['/bin/bash', '/bin/zsh', '/usr/bin/fish', '/bin/sh']) add(s)
  }
  return out
}

/** `wsl.exe -l -q` prints UTF-16LE with NULs and a BOM; keep real distro names only. */
export function parseWslList(raw: Buffer): string[] {
  const text = raw.includes(0) ? raw.toString('utf16le') : raw.toString('utf8')
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\0/g, '').trim())
    .filter((l) => l && !/^docker-desktop/i.test(l))
}

function realEnv(): Env {
  return {
    platform: process.platform,
    env: process.env,
    exists: (p) => {
      try {
        return existsSync(p)
      } catch {
        return false
      }
    },
    realpath: (p) => {
      try {
        return realpathSync(p)
      } catch {
        return p
      }
    },
    which: (exe) => {
      try {
        const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [exe], { encoding: 'utf8', timeout: 3000, windowsHide: true })
        return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null
      } catch {
        return null
      }
    },
    wslDistros: () => {
      try {
        return parseWslList(execFileSync('wsl.exe', ['-l', '-q'], { timeout: 4000, windowsHide: true }))
      } catch {
        return []
      }
    },
    etcShells: () => {
      try {
        return readFileSync('/etc/shells', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'))
      } catch {
        return []
      }
    },
  }
}
