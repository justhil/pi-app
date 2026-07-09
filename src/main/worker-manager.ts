// Worker Manager - per-workspace utility processes; foreground RPC + background turns keep running

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
  disposeWorkerSlot,
  evictBackgroundWorkers,
  forkWorkerForCwd,
  getBackgroundWorkerState,
  slotRequest,
} from './worker-manager-pool'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'

interface InitResult extends WorkerInitResult {}

export class WorkerManager {
  private mainWindow: BrowserWindow | null = null
  private pool = new Map<string, WorkerSlot>()
  private foregroundCwd: string | null = null
  private lifecycleChain: Promise<unknown> = Promise.resolve()

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.startUnlocked(cwd))
    this.lifecycleChain = run.then(() => undefined, () => undefined)
    return run
  }

  private foregroundSlot(): WorkerSlot | null {
    if (!this.foregroundCwd) return null
    return this.pool.get(this.foregroundCwd) ?? null
  }

  private async startUnlocked(cwd: string): Promise<InitResult> {
    const existing = this.pool.get(cwd)
    if (existing && !existing.stopping) {
      const prev = this.foregroundCwd
      this.foregroundCwd = cwd
      evictBackgroundWorkers(this.pool, cwd, prev && prev !== cwd ? prev : null)
      if (existing.initPromise) return existing.initPromise
      const live = await this.requestOnSlot(existing, 'getState').catch(() => null)
      return {
        sessionId: String((live?.state as WorkerState)?.sessionId ?? ''),
        model: (live?.state as WorkerState)?.model as string | undefined,
        thinkingLevel: (live?.state as WorkerState)?.thinkingLevel as string | undefined,
      }
    }

    const prev = this.foregroundCwd
    if (prev !== cwd) {
      try {
        const { traceAudio } = await import('./audio-trace')
        traceAudio('main.workerRestart', { from: prev, to: cwd })
      } catch {
        /* ignore */
      }
    }

    evictBackgroundWorkers(this.pool, cwd, prev && prev !== cwd ? prev : null)

    const { slot, init } = await forkWorkerForCwd(cwd)
    this.pool.set(cwd, slot)
    this.foregroundCwd = cwd

    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: this.mainWindow,
      onAppEvent: ({ event, fromCwd, agentTurnActive }) => this.forwardAppEvent(event, fromCwd, agentTurnActive),
      onSlotExit: (s, code) => this.handleSlotExit(s, code),
    })

    return init
  }

  private forwardAppEvent(event: AppEvent, fromCwd: string, agentTurnActive: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const enriched =
      event && typeof event === 'object' && 'workspaceId' in event
        ? { ...event, workspaceId: (event as { workspaceId?: string }).workspaceId || fromCwd }
        : event
    this.mainWindow.webContents.send('ipc:events', enriched)
    void agentTurnActive
  }

  private handleSlotExit(slot: WorkerSlot, code: number): void {
    const cwdOnExit = slot.cwd
    this.pool.delete(cwdOnExit)
    if (this.foregroundCwd === cwdOnExit) this.foregroundCwd = null
    slot.initPromise = null
    if (slot.initRejecter) {
      slot.initRejecter(new Error(`Worker exited during init with code ${code}`))
      slot.initResolver = null
      slot.initRejecter = null
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:worker-exit', { code, cwd: cwdOnExit })
    }

    if (slot.stopping || code === 0 || !cwdOnExit || !slot.autoRestartEnabled) return

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
        cwd: cwdOnExit,
        message: 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 pi Desktop 进程。',
      })
    }
  }

  async stop(): Promise<void> {
    const run = this.lifecycleChain.then(() => this.stopUnlocked())
    this.lifecycleChain = run.then(() => undefined, () => undefined)
    return run
  }

  private async stopUnlocked(): Promise<void> {
    const slots = [...this.pool.values()]
    this.pool.clear()
    this.foregroundCwd = null
    await Promise.all(slots.map((s) => disposeWorkerSlot(s)))
  }

  private requestOnSlot(
    slot: WorkerSlot,
    type: string,
    data?: WorkerRequestPayload,
  ): Promise<WorkerResponsePayload> {
    return slotRequest(slot, type, data as Record<string, unknown> | undefined)
  }

  private request(type: string, data?: WorkerRequestPayload): Promise<WorkerResponsePayload> {
    const slot = this.foregroundSlot()
    if (!slot) return Promise.reject(new Error('Worker not started'))
    return this.requestOnSlot(slot, type, data)
  }

  async getBackgroundRuntimeState(cwd: string): Promise<WorkerState | null> {
    const row = await getBackgroundWorkerState(this.pool, cwd)
    if (!row) return null
    return (row.state as WorkerState) || null
  }

  async sendPrompt(text: string): Promise<void> {
    await this.request('prompt', { text })
  }
  async abort(): Promise<void> {
    await this.request('abort')
  }
  async steer(text: string): Promise<void> {
    await this.request('steer', { text })
  }
  async followUp(text: string): Promise<void> {
    await this.request('followUp', { text })
  }
  async clearPromptQueue(): Promise<{ steering: string[]; followUp: string[] }> {
    const r = await this.request('clearQueue')
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
  async getState(): Promise<WorkerState> {
    return ((await this.request('getState')).state as WorkerState) || {}
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
  ): Promise<WorkerMessagesPage> {
    const r = await this.request('getMessages', { sessionFile, offset, limit })
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
    opts?: { force?: boolean },
  ): Promise<{ sessionId: string; model?: string }> {
    const r = await this.request('loadSession', { sessionFile, force: opts?.force === true })
    return { sessionId: String(r.sessionId ?? ''), model: r.model as string | undefined }
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
    options?: { summarize?: boolean; label?: string },
  ): Promise<{
    cancelled: boolean
    editorText?: string
    leafId?: string | null
    sessionMeta?: { model?: string; thinkingLevel?: string }
  }> {
    const r = await this.request('navigateTree', { targetId, ...options })
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
    return this.foregroundCwd
  }

  get lastSdkFallback(): boolean {
    return this.foregroundSlot()?.sdkFallback ?? false
  }
}

export const workerManager = new WorkerManager()