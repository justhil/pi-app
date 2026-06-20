/** Session JSONL bound to Worker only after user sends a prompt (fast Timeline switch). */
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
  loadSession: (sessionFile: string) => Promise<{ sessionId: string; model?: string }>,
): Promise<void> {
  if (pendingEphemeralSandboxDraft) {
    throw new Error('EPHEMERAL_SANDBOX_DRAFT')
  }
  const file = pendingWorkerSessionFile
  if (!file) return
  await loadSession(file)
  pendingWorkerSessionFile = null
}