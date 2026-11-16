import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { UsageLogQuery } from '@shared/usage-summary'
import { resolveActiveAgentDir } from '../../agent-dir'
import { sessionPreviewProcess } from '../../session-preview-process'
import { awaitWslVm } from '../../wsl/wsl-env'
import { registerHandler } from '../registry'

const DAY = 86_400_000

function computeTimeWindow(daysRaw: unknown): { from: number; to: number; offsetMin: number } {
  const days = typeof daysRaw === 'number' && Number.isFinite(daysRaw) ? Math.max(0, Math.floor(daysRaw)) : 30
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const to = today + DAY
  const from = days > 0 ? to - days * DAY : 0
  return { from, to, offsetMin: -now.getTimezoneOffset() }
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

async function resolveAllowedSessionRoots(agentDir: string): Promise<string[]> {
  const roots = [join(agentDir, 'sessions')]
  try {
    const raw = await readFile(join(agentDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as { sessionDir?: unknown }
    if (typeof parsed.sessionDir === 'string' && parsed.sessionDir.trim()) {
      const p = expandHome(parsed.sessionDir.trim())
      roots.push(isAbsolute(p) ? p : join(agentDir, p))
    }
  } catch {
    /* optional */
  }
  return roots
}

function isInsideRoot(filePath: string, rootDir: string): boolean {
  const normFile = normalize(filePath)
  const normRoot = normalize(rootDir).replace(/[\\/]+$/, '')
  const prefix = normRoot + sep
  if (process.platform === 'win32') {
    return normFile.toLowerCase().startsWith(prefix.toLowerCase())
  }
  return normFile.startsWith(prefix)
}

async function assertAuthorizedUsageSessionFile(sessionFile: string, agentDir: string): Promise<void> {
  if (!sessionFile || !sessionFile.endsWith('.jsonl') || sessionFile.includes('\0')) {
    throw new Error('untrusted_session_file')
  }
  const roots = await resolveAllowedSessionRoots(agentDir)
  if (!roots.some((r) => isInsideRoot(sessionFile, r))) {
    throw new Error('untrusted_session_file')
  }
}

export function registerUsageHandlers(): void {
  registerHandler('ipc:usage.summary', async (req: { days?: number }) => {
    await awaitWslVm()
    const { from, to, offsetMin } = computeTimeWindow(req?.days)
    return sessionPreviewProcess.usageSummary({
      agentDir: resolveActiveAgentDir(),
      from,
      to,
      offsetMin,
    })
  })

  registerHandler('ipc:usage.logs', async (req: UsageLogQuery) => {
    await awaitWslVm()
    const { from, to } = computeTimeWindow(req?.days)
    return sessionPreviewProcess.usageLogs({
      agentDir: resolveActiveAgentDir(),
      from,
      to,
      model: req?.model,
      project: req?.project,
      api: req?.api,
      status: req?.status,
      search: req?.search,
      sortBy: req?.sortBy,
      sortDir: req?.sortDir,
      offset: req?.offset,
      limit: req?.limit,
    })
  })

  registerHandler('ipc:usage.requestDetail', async (req: { sessionFile: string; entryId: string }) => {
    await awaitWslVm()
    const sessionFile = typeof req?.sessionFile === 'string' ? req.sessionFile.trim() : ''
    const entryId = typeof req?.entryId === 'string' ? req.entryId.trim() : ''
    if (!entryId) throw new Error('missing_entry_id')
    const agentDir = resolveActiveAgentDir()
    await assertAuthorizedUsageSessionFile(sessionFile, agentDir)
    return sessionPreviewProcess.usageRequestDetail({ sessionFile, entryId })
  })
}
