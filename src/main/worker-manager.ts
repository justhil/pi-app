// Worker Manager - multi-session utility process pool (sessionKey + workspace keys)

import { type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'
import type {
  WorkerCommandInfo,
  WorkerCompletionItem,
  WorkerContextPreview,
  WorkerMessagesPage,
  WorkerModelRow,
  WorkerPromptTemplate,
  WorkerRequestPayload,
  WorkerResponsePayload,
  WorkerSessionOnDisk,
  WorkerSessionTreeNode,
  WorkerSkillInfo,
  WorkerState,
} from '@shared/worker-rpc-types'
import {
  attachWorkerHandlers,
  canAcquireNewWorker,
  disposeWorkerSlot,
  evictIdleWorkers,
  forkWorkerForCwd,
  getBackgroundWorkerState,
  pruneIdleWorkersByTimeout,
  slotRequest,
} from './worker-manager-pool'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'
import { normalizeSessionKey, workspacePoolKey } from './worker-session-key'
import { readMaxSessionWorkers } from './worker-pool-config'
import { configStore } from './config-store'

interface InitResult extends WorkerInitResult {}

export class WorkerManager {
  private mainWindow: BrowserWindow | null = null
  /** Key: session abs path or `ws:${cwd}` */
  private pool = new Map<string, WorkerSlot>()
  private foregroundPoolKey: string | null = null
  private lifecycleChain: Promise<unknown> = Promise.resolve()
  private idleTimer: ReturnType<typeof setInterval> | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    this.ensureIdleTimer()
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      try {
        pruneIdleWorkersByTimeout(this.pool, this.foregroundPoolKey)
      } catch {
        /* ignore */
      }
    }, 60_000)
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      ;(this.idleTimer as NodeJS.Timeout).unref?.()
    }
  }

  async start(cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.startWorkspaceUnlocked(cwd))
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Acquire or create a worker bound to sessionFile (F1). Requires workspace cwd. */
  async ensureSessionWorker(sessionFile: string, cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.ensureSessionWorkerUnlocked(sessionFile, cwd))
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private foregroundSlot(): WorkerSlot | null {
    if (!this.foregroundPoolKey) return null
    return this.pool.get(this.foregroundPoolKey) ?? null
  }

  private setForeground(slot: WorkerSlot): void {
    this.foregroundPoolKey = slot.poolKey
    slot.lastForegroundAt = Date.now()
  }

  private async startWorkspaceUnlocked(cwd: string): Promise<InitResult> {
    const key = workspacePoolKey(cwd)
    const existing = this.pool.get(key)
    if (existing && !existing.stopping) {
      const prev = this.foregroundPoolKey
      this.setForeground(existing)
      evictIdleWorkers(this.pool, {
        foregroundKey: key,
        keepKeys: prev && prev !== key ? [prev] : [],
        maxWorkers: readMaxSessionWorkers(),
      })
      if (existing.initPromise) return existing.initPromise
      const live = await this.requestOnSlot(existing, 'getState').catch(() => null)
      return {
        sessionId: String((live?.state as WorkerState)?.sessionId ?? ''),
        model: (live?.state as WorkerState)?.model as string | undefined,
        thinkingLevel: (live?.state as WorkerState)?.thinkingLevel as string | undefined,
      }
    }

    // Prefer reusing any session slot already on this cwd as workspace foreground
    for (const slot of this.pool.values()) {
      if (slot.cwd === cwd && !slot.stopping) {
        this.setForeground(slot)
        return this.initResultFromSlot(slot)
      }
    }

    const cap = canAcquireNewWorker(this.pool)
    if (!cap.ok) {
      evictIdleWorkers(this.pool, {
        foregroundKey: this.foregroundPoolKey,
        maxWorkers: readMaxSessionWorkers(),
      })
    }
    const cap2 = canAcquireNewWorker(this.pool)
    if (!cap2.ok) throw new Error(cap2.reason)

    const prev = this.foregroundPoolKey
    const { slot, init } = await forkWorkerForCwd(cwd, { poolKey: key, sessionFile: null })
    this.pool.set(key, slot)
    this.setForeground(slot)

    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: this.mainWindow,
      getForegroundPoolKey: () => this.foregroundPoolKey,
      onAppEvent: (p) => this.forwardAppEvent(p),
      onSlotExit: (s, code) => this.handleSlotExit(s, code),
    })

    evictIdleWorkers(this.pool, {
      foregroundKey: key,
      keepKeys: prev && prev !== key ? [prev] : [],
      maxWorkers: readMaxSessionWorkers(),
    })

    return init
  }

  private async ensureSessionWorkerUnlocked(sessionFile: string, cwd: string): Promise<InitResult> {
    const sk = normalizeSessionKey(sessionFile)
    if (!sk) throw new Error('sessionFile required')

    const existing = this.pool.get(sk)
    if (existing && !existing.stopping) {
      const prev = this.foregroundPoolKey
      this.setForeground(existing)
      existing.sessionFile = sk
      evictIdleWorkers(this.pool, {
        foregroundKey: sk,
        keepKeys: prev && prev !== sk ? [prev] : [],
        maxWorkers: readMaxSessionWorkers(),
      })
      if (existing.initPromise) await existing.initPromise
      // Bind live session on worker
      await this.requestOnSlot(existing, 'loadSession', { sessionFile: sk }).catch(() => null)
      return this.initResultFromSlot(existing)
    }

    // Reuse workspace slot on same cwd if unbound / same session
    const wsKey = workspacePoolKey(cwd)
    const wsSlot = this.pool.get(wsKey)
    if (wsSlot && !wsSlot.stopping && (!wsSlot.sessionFile || wsSlot.sessionFile === sk)) {
      this.pool.delete(wsKey)
      wsSlot.poolKey = sk
      wsSlot.sessionFile = sk
      this.pool.set(sk, wsSlot)
      this.setForeground(wsSlot)
      if (wsSlot.initPromise) await wsSlot.initPromise
      await this.requestOnSlot(wsSlot, 'loadSession', { sessionFile: sk })
      return this.initResultFromSlot(wsSlot)
    }

    const cap = canAcquireNewWorker(this.pool)
    if (!cap.ok) {
      evictIdleWorkers(this.pool, {
        foregroundKey: this.foregroundPoolKey,
        maxWorkers: readMaxSessionWorkers(),
      })
    }
    const cap2 = canAcquireNewWorker(this.pool)
    if (!cap2.ok) throw new Error(cap2.reason)

    const prev = this.foregroundPoolKey
    const { slot, init } = await forkWorkerForCwd(cwd, { poolKey: sk, sessionFile: sk })
    this.pool.set(sk, slot)
    this.setForeground(slot)

    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: this.mainWindow,
      getForegroundPoolKey: () => this.foregroundPoolKey,
      onAppEvent: (p) => this.forwardAppEvent(p),
      onSlotExit: (s, code) => this.handleSlotExit(s, code),
    })

    await init
    await this.requestOnSlot(slot, 'loadSession', { sessionFile: sk })

    evictIdleWorkers(this.pool, {
      foregroundKey: sk,
      keepKeys: prev && prev !== sk ? [prev] : [],
      maxWorkers: readMaxSessionWorkers(),
    })

    return this.initResultFromSlot(slot)
  }

  private async initResultFromSlot(slot: WorkerSlot): Promise<InitResult> {
    if (slot.initPromise) {
      try {
        return await slot.initPromise
      } catch {
        /* fall through */
      }
    }
    const live = await this.requestOnSlot(slot, 'getState').catch(() => null)
    return {
      sessionId: String((live?.state as WorkerState)?.sessionId ?? ''),
      model: (live?.state as WorkerState)?.model as string | undefined,
      thinkingLevel: (live?.state as WorkerState)?.thinkingLevel as string | undefined,
    }
  }

  private forwardAppEvent(payload: {
    event: AppEvent
    fromCwd: string
    fromPoolKey: string
    sessionFile: string | null
    agentTurnActive: boolean
  }): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const { event, fromCwd, sessionFile, agentTurnActive } = payload
    let enriched = event
    if (event && typeof event === 'object') {
      const base = { ...(event as object) } as Record<string, unknown>
      if ('workspaceId' in event) {
        base.workspaceId = (event as { workspaceId?: string }).workspaceId || fromCwd
      }
      if (sessionFile && !base.sessionFile) base.sessionFile = sessionFile
      enriched = base as unknown as AppEvent
    }
    this.mainWindow.webContents.send('ipc:events', enriched)
    void agentTurnActive
  }

  private handleSlotExit(slot: WorkerSlot, code: number): void {
    const key = slot.poolKey
    if (this.pool.get(key) === slot) this.pool.delete(key)
    if (this.foregroundPoolKey === key) this.foregroundPoolKey = null
    slot.initPromise = null
    if (slot.initRejecter) {
      slot.initRejecter(new Error(`Worker exited during init with code ${code}`))
      slot.initResolver = null
      slot.initRejecter = null
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:worker-exit', {
        code,
        cwd: slot.cwd,
        sessionFile: slot.sessionFile,
        poolKey: key,
      })
    }

    if (slot.stopping || code === 0 || !slot.autoRestartEnabled) return

    try {
      process.stderr.write(
        '[WorkerManager] Worker crashed; auto-restart is disabled — not spawning another worker\n',
      )
    } catch {
      /* ignore */
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:worker-fatal', {
        code,
        cwd: slot.cwd,
        sessionFile: slot.sessionFile,
        message: 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 pi Desktop 进程。',
      })
    }
  }

  async stop(): Promise<void> {
    const run = this.lifecycleChain.then(() => this.stopUnlocked())
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async stopUnlocked(): Promise<void> {
    const slots = [...this.pool.values()]
    this.pool.clear()
    this.foregroundPoolKey = null
    await Promise.all(slots.map((s) => disposeWorkerSlot(s)))
  }

  private requestOnSlot(
    slot: WorkerSlot,
    type: string,
    data?: WorkerRequestPayload,
  ): Promise<WorkerResponsePayload> {
    return slotRequest(slot, type, data as Record<string, unknown> | undefined)
  }

  /**
   * Workspace cwd for lazy Worker creation.
   * After cold start without ensureWorker, foreground may be empty — fall back to
   * persisted currentProject so rewind/prompt can still spawn a session Worker.
   */
  resolveWorkspaceCwd(preferred?: string | null): string | null {
    const fromPreferred = preferred?.trim()
    if (fromPreferred) return fromPreferred
    if (this.cwd) return this.cwd
    const fromConfig = configStore.get('currentProject')
    if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim()
    return null
  }

  private async resolveSlotForRpc(sessionFile?: string | null): Promise<WorkerSlot> {
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const bySession = this.pool.get(sk)
      if (bySession && !bySession.stopping) {
        this.setForeground(bySession)
        return bySession
      }
      const cwd = this.resolveWorkspaceCwd(bySession?.cwd)
      if (!cwd) {
        // try any slot matching session after load on foreground
        const fg = this.foregroundSlot()
        if (fg) return fg
        throw new Error('Worker not started for session')
      }
      await this.ensureSessionWorkerUnlocked(sessionFile, cwd)
      const slot = this.pool.get(sk)
      if (!slot) throw new Error('Worker not started for session')
      return slot
    }
    const slot = this.foregroundSlot()
    if (!slot) throw new Error('Worker not started')
    return slot
  }

  private request(type: string, data?: WorkerRequestPayload): Promise<WorkerResponsePayload> {
    const sessionFile =
      data && typeof data === 'object' && 'sessionFile' in data
        ? (data as { sessionFile?: string }).sessionFile
        : undefined
    return this.resolveSlotForRpc(sessionFile).then((slot) => this.requestOnSlot(slot, type, data))
  }

  async getBackgroundRuntimeState(poolKeyOrCwd: string): Promise<WorkerState | null> {
    // Accept session key or legacy cwd
    let key = poolKeyOrCwd
    if (!this.pool.has(key) && !key.startsWith('ws:')) {
      key = workspacePoolKey(poolKeyOrCwd)
    }
    const row = await getBackgroundWorkerState(this.pool, key)
    if (!row) return null
    return (row.state as WorkerState) || null
  }

  /** Snapshot of running flags for renderer sessionRuntime */
  listSessionRuntime(): Array<{ sessionFile: string; running: boolean; cwd: string }> {
    const out: Array<{ sessionFile: string; running: boolean; cwd: string }> = []
    for (const slot of this.pool.values()) {
      if (!slot.sessionFile) continue
      out.push({
        sessionFile: slot.sessionFile,
        running: slot.agentTurnActive,
        cwd: slot.cwd,
      })
    }
    return out
  }

  async sendPrompt(text: string, sessionFile?: string): Promise<void> {
    await this.request('prompt', { text, sessionFile })
  }
  /**
   * Abort agent turn on the session's existing worker only.
   * Never ensure/create a worker just to abort (would race F1 / wrong cwd).
   */
  async abort(sessionFile?: string): Promise<void> {
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const slot = this.pool.get(sk)
      if (!slot || slot.stopping) {
        // No live worker for this session — already idle from UI's perspective.
        return
      }
      await this.requestOnSlot(slot, 'abort', { sessionFile: sk })
      slot.agentTurnActive = false
      slot.lastIdleAt = Date.now()
      return
    }
    await this.request('abort', {})
    const fg = this.foregroundSlot()
    if (fg) {
      fg.agentTurnActive = false
      fg.lastIdleAt = Date.now()
    }
  }
  async steer(text: string, sessionFile?: string): Promise<void> {
    await this.request('steer', { text, sessionFile })
  }
  async followUp(text: string, sessionFile?: string): Promise<void> {
    await this.request('followUp', { text, sessionFile })
  }
  async clearPromptQueue(sessionFile?: string): Promise<{ steering: string[]; followUp: string[] }> {
    const r = await this.request('clearQueue', sessionFile ? { sessionFile } : {})
    return { steering: (r.steering as string[]) || [], followUp: (r.followUp as string[]) || [] }
  }
  async setModel(provider: string, modelId: string): Promise<void> {
    await this.request('setModel', { provider, modelId })
  }
  async setThinkingLevel(level: string): Promise<void> {
    await this.request('setThinkingLevel', { level })
  }
  async newSession(): Promise<{ sessionId: string }> {
    const r = await this.request('newSession')
    return { sessionId: String(r.sessionId ?? '') }
  }
  async listSessions(cwd?: string): Promise<WorkerSessionOnDisk[]> {
    const r = await this.request('listSessions', { cwd })
    return (r.sessions as WorkerSessionOnDisk[]) || []
  }
  /**
   * Read-only runtime snapshot.
   * When sessionFile is set: ONLY query an existing pool slot for that session.
   * Never fall back to another session's foreground worker (would mis-report isStreaming),
   * and never ensure/create a worker just for a status poll.
   */
  async getState(sessionFile?: string): Promise<WorkerState> {
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const slot = this.pool.get(sk)
      if (!slot || slot.stopping) {
        return {
          sessionFile: sk || sessionFile,
          isStreaming: false,
        } as WorkerState
      }
      try {
        const r = await this.requestOnSlot(slot, 'getState')
        const state = ((r.state as WorkerState) || {}) as WorkerState
        // Always stamp the pool identity so renderer cannot mis-attribute streaming.
        return {
          ...state,
          sessionFile: slot.sessionFile || sk,
          isStreaming: !!(state as { isStreaming?: boolean }).isStreaming || slot.agentTurnActive,
        }
      } catch {
        return {
          sessionFile: slot.sessionFile || sk,
          isStreaming: slot.agentTurnActive,
        } as WorkerState
      }
    }
    return ((await this.request('getState', {})).state as WorkerState) || {}
  }
  async getCommands(): Promise<{ commands: WorkerCommandInfo[]; hasSession: boolean }> {
    const r = await this.request('getCommands')
    return { commands: (r.commands as WorkerCommandInfo[]) || [], hasSession: !!r.hasSession }
  }
  async getSessionContextPreview(): Promise<WorkerContextPreview> {
    const r = await this.request('getSessionContextPreview')
    return (r.preview as WorkerContextPreview) || null
  }
  async getSkillsList(): Promise<WorkerSkillInfo[]> {
    const r = await this.request('getSkillsList')
    return (r.skills as WorkerSkillInfo[]) || []
  }
  async getPromptTemplatesList(): Promise<WorkerPromptTemplate[]> {
    const r = await this.request('getPromptTemplatesList')
    return (r.prompts as WorkerPromptTemplate[]) || []
  }
  async getContextPrompts(): Promise<WorkerResponsePayload> {
    return this.request('getContextPrompts')
  }
  async reloadResources(): Promise<void> {
    await this.request('reloadResources')
  }
  async getCommandCompletions(commandName: string, argumentPrefix: string): Promise<WorkerCompletionItem[]> {
    const r = await this.request('getCommandCompletions', { commandName, argumentPrefix })
    return (r.items as WorkerCompletionItem[]) || []
  }
  async getModels(): Promise<WorkerModelRow[]> {
    const r = await this.request('getModels')
    return (r.models as WorkerModelRow[]) || []
  }
  async reloadModels(): Promise<void> {
    if (!this.isRunning) return
    await this.request('reloadModels')
  }
  async getPiSettings(): Promise<Record<string, unknown>> {
    return ((await this.request('getPiSettings')).settings as Record<string, unknown>) || {}
  }
  async setPiSettings(patch: Record<string, unknown>): Promise<void> {
    await this.request('setPiSettings', { patch })
  }
  async getMessages(
    sessionFile: string,
    offset?: number,
    limit?: number,
    leafId?: string | null,
  ): Promise<WorkerMessagesPage> {
    const payload: Record<string, unknown> = { sessionFile, offset, limit }
    if (leafId !== undefined) payload.leafId = leafId
    const r = await this.request('getMessages', payload)
    return {
      items: (r.items as WorkerMessagesPage['items']) || [],
      totalCount:
        typeof r.totalCount === 'number'
          ? r.totalCount
          : Array.isArray(r.items)
            ? r.items.length
            : 0,
      sessionMeta: r.sessionMeta as WorkerMessagesPage['sessionMeta'],
    }
  }
  async loadSession(
    sessionFile: string,
    opts?: { force?: boolean; cwd?: string; leafId?: string | null },
  ): Promise<{ sessionId: string; model?: string; leafId?: string | null }> {
    // Lazy-start path: must resolve cwd even when no Worker is running yet.
    const cwd = this.resolveWorkspaceCwd(opts?.cwd)
    if (!cwd) {
      throw new Error('Worker not started for session')
    }
    await this.ensureSessionWorker(sessionFile, cwd)
    // Re-apply rewound leaf tip (main override map) so agent context matches UI.
    let leafId = opts?.leafId
    if (leafId === undefined) {
      try {
        const { getSessionLeafOverride } = await import('./session-leaf-override.js')
        leafId = getSessionLeafOverride(sessionFile)
      } catch {
        leafId = undefined
      }
    }
    const r = await this.request('loadSession', {
      sessionFile,
      force: opts?.force === true,
      ...(leafId !== undefined ? { leafId } : {}),
    })
    const sk = normalizeSessionKey(sessionFile)
    const slot = this.pool.get(sk) || this.foregroundSlot()
    if (slot) {
      slot.sessionFile = sk
      if (slot.poolKey !== sk && sk) {
        this.pool.delete(slot.poolKey)
        slot.poolKey = sk
        this.pool.set(sk, slot)
        this.foregroundPoolKey = sk
      }
    }
    return {
      sessionId: String(r.sessionId ?? ''),
      model: r.model as string | undefined,
      leafId: (r.leafId as string | null | undefined) ?? null,
    }
  }
  async renameSessionFile(sessionFile: string, title: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    const r = await this.request('sessionRenameFile', { sessionFile, title })
    return { ok: !!r.ok, title: r.title as string | undefined, error: r.error as string | undefined }
  }
  async deleteSessionFile(sessionFile: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.request('sessionDeleteFile', { sessionFile })
    return { ok: !!r.ok, error: r.error as string | undefined }
  }
  async getSessionTree(sessionFile?: string): Promise<{ nodes: WorkerSessionTreeNode[]; leafId: string | null; error?: string }> {
    const r = await this.request('getSessionTree', sessionFile ? { sessionFile } : {})
    return {
      nodes: (r.nodes as WorkerSessionTreeNode[]) || [],
      leafId: (r.leafId as string | null) ?? null,
      error: r.error as string | undefined,
    }
  }
  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; label?: string; sessionFile?: string },
  ): Promise<{
    cancelled: boolean
    editorText?: string
    leafId?: string | null
    sessionMeta?: { model?: string; thinkingLevel?: string }
    error?: string
  }> {
    const sessionFile = options?.sessionFile
    const r = await this.request('navigateTree', {
      targetId,
      summarize: options?.summarize,
      label: options?.label,
      ...(sessionFile ? { sessionFile } : {}),
    })
    if (r.type === 'error') {
      return {
        cancelled: true,
        error: String((r as { error?: string }).error || 'navigateTree failed'),
      }
    }
    return {
      cancelled: !!r.cancelled,
      editorText: r.editorText as string | undefined,
      leafId: (r.leafId as string | null) ?? null,
      sessionMeta: r.sessionMeta as { model?: string; thinkingLevel?: string } | undefined,
    }
  }
  async runExtensionCommand(text: string): Promise<void> {
    await this.request('runExtensionCommand', { text })
  }

  respondExtensionUI(response: {
    id: string
    value?: string
    confirmed?: boolean
    cancelled?: boolean
    result?: unknown
  }): void {
    const slot = this.foregroundSlot()
    if (!slot) return
    slot.worker.postMessage({ type: 'extension-ui-response', response })
  }

  get isRunning(): boolean {
    return this.foregroundSlot() != null
  }

  async awaitReady(): Promise<void> {
    const slot = this.foregroundSlot()
    if (slot?.initPromise) await slot.initPromise.catch(() => {})
  }

  get cwd(): string | null {
    return this.foregroundSlot()?.cwd ?? null
  }

  get lastSdkFallback(): boolean {
    return this.foregroundSlot()?.sdkFallback ?? false
  }

  get foregroundSessionFile(): string | null {
    return this.foregroundSlot()?.sessionFile ?? null
  }
}

export const workerManager = new WorkerManager()
