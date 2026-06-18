import { app, Notification } from 'electron'
import { workerManager } from './worker-manager'

export function notifyAgentComplete(): void {
  if (Notification.isSupported()) {
    new Notification({
      title: 'pi Desktop',
      body: 'Agent 已完成运行',
      silent: false,
    }).show()
  }
}

let lastRunStatus: string = 'idle'

export function checkAndNotify(status: string): void {
  if (lastRunStatus === 'running' && status === 'idle') {
    notifyAgentComplete()
  }
  lastRunStatus = status
}
