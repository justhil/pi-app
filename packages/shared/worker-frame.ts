/**
 * Stdio framing for the WSL worker transport.
 *
 * When the worker runs inside WSL there is no Electron `process.parentPort`,
 * so main and worker talk over a newline-delimited JSON channel. To stay
 * robust against stray log lines leaking onto stdout, every worker frame is
 * prefixed with a magic token; the main side ignores anything without it.
 */

export const WORKER_STDIO_PREFIX = 'piw1:'

export function encodeWorkerFrame(payload: Record<string, unknown>): string {
  return `${WORKER_STDIO_PREFIX}${JSON.stringify(payload)}`
}

/** Parse a single stdout line into a worker payload, or null when not a frame. */
export function decodeWorkerFrameLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(WORKER_STDIO_PREFIX)) return null
  try {
    const parsed = JSON.parse(trimmed.slice(WORKER_STDIO_PREFIX.length)) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

export const WORKER_STDIO_ENV = 'PI_WORKER_STDIO' as const
export const WORKER_WSL_DISTRO_ENV = 'PI_WSL_DISTRO' as const
