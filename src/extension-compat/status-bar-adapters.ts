import type {
  BackgroundJobsLogFileRule,
  BackgroundJobsProtocolSpec,
} from '@shared/background-tasks'
import type { AdapterJson } from './adapter-schema'
import { loadAdapterCatalog } from './adapter-loader'

export function statusBarAdapters(projectDir?: string): AdapterJson[] {
  return loadAdapterCatalog(projectDir).adapters.filter((adapter) => Boolean(adapter.statusBar))
}

export function backgroundJobsAdapters(projectDir?: string): AdapterJson[] {
  return statusBarAdapters(projectDir).filter(
    (adapter) => adapter.statusBar?.protocol === 'background-jobs-v1',
  )
}

export function statusPillAdapters(projectDir?: string): AdapterJson[] {
  return statusBarAdapters(projectDir).filter(
    (adapter) => adapter.statusBar?.protocol === 'status-pill-v1',
  )
}

export function toBackgroundJobsProtocolSpec(adapter: AdapterJson): BackgroundJobsProtocolSpec | null {
  const sb = adapter.statusBar
  if (!sb || sb.protocol !== 'background-jobs-v1') return null
  return {
    adapterId: adapter.id,
    tools: sb.tools ?? adapter.match?.tools ?? [],
    exitMessageTypes: sb.exitMessageTypes ?? [],
    statusKeys: sb.statusKeys ?? [],
    inspectTool: sb.actions?.inspectTool,
    killTool: sb.actions?.killTool,
    logFile: sb.logFile,
    fields: sb.fields,
    icon: sb.icon,
    title: sb.title ?? adapter.displayName,
  }
}

export function listBackgroundJobsSpecs(projectDir?: string): BackgroundJobsProtocolSpec[] {
  return backgroundJobsAdapters(projectDir)
    .map(toBackgroundJobsProtocolSpec)
    .filter((spec): spec is BackgroundJobsProtocolSpec => spec !== null)
}

export function resolveBackgroundJobsSpecByTool(
  toolName: string,
  projectDir?: string,
): BackgroundJobsProtocolSpec | null {
  const name = String(toolName || '').trim()
  if (!name) return null
  return listBackgroundJobsSpecs(projectDir).find((spec) => spec.tools.includes(name)) ?? null
}

export function resolveBackgroundJobsSpecByExitMessage(
  customType: string,
  projectDir?: string,
): BackgroundJobsProtocolSpec | null {
  const ct = String(customType || '').trim()
  if (!ct) return null
  return listBackgroundJobsSpecs(projectDir).find((spec) => spec.exitMessageTypes.includes(ct)) ?? null
}

export function resolveBackgroundJobsSpecByStatusKey(
  statusKey: string,
  projectDir?: string,
): BackgroundJobsProtocolSpec | null {
  const key = String(statusKey || '').trim()
  if (!key) return null
  return listBackgroundJobsSpecs(projectDir).find((spec) => spec.statusKeys.includes(key)) ?? null
}

export function resolveStatusPillAdapterByKey(
  statusKey: string,
  projectDir?: string,
): AdapterJson | null {
  const key = String(statusKey || '').trim()
  if (!key) return null
  return statusPillAdapters(projectDir).find((adapter) => adapter.statusBar?.statusKeys?.includes(key)) ?? null
}

export function collectAllowedBackgroundLogRules(projectDir?: string): BackgroundJobsLogFileRule[] {
  const rules: BackgroundJobsLogFileRule[] = []
  for (const spec of listBackgroundJobsSpecs(projectDir)) {
    if (spec.logFile) rules.push(spec.logFile)
  }
  return rules
}
