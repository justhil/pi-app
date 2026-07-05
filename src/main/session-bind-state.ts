/**
 * Session JSONL bound to Worker only after user sends a prompt (fast Timeline switch).
 * Timeline preview: session.getMessages reads JSONL via buildTimelinePageFromSessionFile (main disk fallback or Worker RPC).
 * Agent turn / navigateTree: ensureWorkerSessionBound → loadSession binds the live AgentSession.
 */
let pendingWorkerSessionFile: string | null = null

/** 首条消息前尚未创建磁盘目录的临时对话草稿 */
let pendingEphemeralSandboxDraft = false

export function setPendingEphemeralSandboxDraft(v: boolean): void {
  pendingEphemeralSandboxDraft = v
}

export function isPendingEphemeralSandboxDraft(): boolean {
  return pendingEphemeralSandboxDraft
}

export function setPendingWorkerSessionFile(file: string | null): void {
  pendingWorkerSessionFile = file
}

export function getPendingWorkerSessionFile(): string | null {
  return pendingWorkerSessionFile
}

export async function ensureWorkerSessionBound(
  loadSession: (
    sessionFile: string,
    opts?: { force?: boolean },
  ) => Promise<{ sessionId: string; model?: string }>,
  opts?: { force?: boolean; sessionFile?: string | null },
): Promise<void> {
  if (pendingEphemeralSandboxDraft) {
    throw new Error('EPHEMERAL_SANDBOX_DRAFT')
  }
  const file = opts?.sessionFile || pendingWorkerSessionFile
  if (!file) return
  await loadSession(file, { force: opts?.force === true })
  pendingWorkerSessionFile = null
}