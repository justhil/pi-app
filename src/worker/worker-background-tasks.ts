import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { st } from './worker-runtime.js'

export async function handleListBackgroundTasks(
  _msg: WorkerIncomingMessage,
  reply: WorkerReply,
): Promise<void> {
  if (!st.statusBarHost) {
    reply({ ok: true, tasks: [], activeAdapter: null })
    return
  }
  const { tasks, activeAdapter } = await st.statusBarHost.listTasks()
  reply({ ok: true, tasks, activeAdapter })
}

export async function handleInspectBackgroundTask(
  msg: WorkerIncomingMessage,
  reply: WorkerReply,
): Promise<void> {
  const taskId = String(msg.taskId || '').trim()
  if (!taskId) {
    reply({ ok: false, error: 'Missing taskId' })
    return
  }
  if (!st.statusBarHost) {
    reply({ ok: true, task: null, tail: '', truncated: false, sizeBytes: 0 })
    return
  }
  const outputPath = typeof msg.outputPath === 'string' ? msg.outputPath : undefined
  const res = await st.statusBarHost.inspectTask(taskId, outputPath)
  reply(res)
}

export async function handleKillBackgroundTask(
  msg: WorkerIncomingMessage,
  reply: WorkerReply,
): Promise<void> {
  const taskId = String(msg.taskId || '').trim()
  if (!taskId) {
    reply({ ok: false, error: 'Missing taskId' })
    return
  }
  if (!st.statusBarHost) {
    reply({ ok: false, error: 'Status bar host is not active' })
    return
  }
  const res = await st.statusBarHost.killTask(taskId)
  reply(res)
}
