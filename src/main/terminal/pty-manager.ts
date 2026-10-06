import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ShellProfile } from './shell-profiles'

/** The slice of node-pty this module uses (so tests can pass a fake). */
export type PtyProcess = {
  pid: number
  onData(cb: (data: string) => void): { dispose(): void } | void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } | void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
export type SpawnPty = (file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => PtyProcess

export type TerminalSink = {
  data(id: string, data: string): void
  exit(id: string, code: number): void
}

/** Output is batched this long before it crosses IPC (a `cat` of a big file would otherwise send thousands of messages). */
const FLUSH_MS = 16
const MAX_BATCH = 256 * 1024

type Entry = { pty: PtyProcess; profile: ShellProfile; buf: string; timer: ReturnType<typeof setTimeout> | null }

export class PtyManager {
  private readonly ptys = new Map<string, Entry>()
  private seq = 0

  constructor(
    private readonly spawn: SpawnPty,
    private readonly sink: TerminalSink,
    private readonly baseEnv: () => NodeJS.ProcessEnv,
  ) {}

  get count(): number {
    return this.ptys.size
  }

  create(profile: ShellProfile, opts: { cwd?: string; cols: number; rows: number }): { id: string; pid: number } {
    const cwd = opts.cwd && existsSync(opts.cwd) && statSync(opts.cwd).isDirectory() ? opts.cwd : homedir()
    const env = { ...this.baseEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'pi-desktop' }
    const pty = this.spawn(profile.path, profile.args, { name: 'xterm-256color', cols: clampDim(opts.cols, 80), rows: clampDim(opts.rows, 24), cwd, env })
    const id = `t${++this.seq}`
    const entry: Entry = { pty, profile, buf: '', timer: null }
    this.ptys.set(id, entry)
    pty.onData((d) => this.push(id, d))
    pty.onExit(({ exitCode }) => {
      this.flush(id)
      this.ptys.delete(id)
      this.sink.exit(id, exitCode)
    })
    return { id, pid: pty.pid }
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.ptys.get(id)
    if (!e) return
    try {
      e.pty.resize(clampDim(cols, 80), clampDim(rows, 24))
    } catch {
      /* the process may have just exited */
    }
  }

  kill(id: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    this.ptys.delete(id)
    try {
      e.pty.kill()
    } catch {
      /* already gone */
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }

  private push(id: string, data: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    e.buf += data
    if (e.buf.length >= MAX_BATCH) return this.flush(id)
    if (!e.timer) e.timer = setTimeout(() => this.flush(id), FLUSH_MS)
  }

  private flush(id: string): void {
    const e = this.ptys.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    if (!e.buf) return
    const out = e.buf
    e.buf = ''
    this.sink.data(id, out)
  }
}

function clampDim(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 1000) : fallback
}
