import { describe, expect, it } from 'vitest'
import { parseAdapterDeclaration } from './adapter-validation'
import { resolveAdapterText } from './adapter-schema'
import { BUILTIN_ADAPTERS } from './builtin-adapters'
import {
  collectAllowedBackgroundLogRules,
  listBackgroundJobsSpecs,
  resolveBackgroundJobsSpecByExitMessage,
  resolveBackgroundJobsSpecByTool,
  resolveStatusPillAdapterByKey,
} from './status-bar-adapters'
import {
  extractBackgroundTasksFromBranchEntries,
  isSafeBackgroundLogPath,
} from '@shared/background-tasks'

describe('statusBar adapter schema, validation & custom protocol decoupling', () => {
  it('auto-collects all builtin adapters including pi-background-terminal with background-jobs-v1', () => {
    expect(BUILTIN_ADAPTERS.length).toBeGreaterThanOrEqual(40)
    const bg = BUILTIN_ADAPTERS.find((a) => a.id === '@bytetrue/pi-background-terminal')
    expect(bg?.tier).toBe('native')
    expect(bg?.statusBar?.protocol).toBe('background-jobs-v1')
    expect(listBackgroundJobsSpecs().some((s) => s.adapterId === '@bytetrue/pi-background-terminal')).toBe(true)
    expect(resolveBackgroundJobsSpecByTool('background_run')?.adapterId).toBe('@bytetrue/pi-background-terminal')
    expect(resolveBackgroundJobsSpecByExitMessage('background-exit')?.adapterId).toBe('@bytetrue/pi-background-terminal')
    expect(collectAllowedBackgroundLogRules().some((r) => r.dirName === 'pi-background-terminal')).toBe(true)

    // Real builtin status-pill-v1 adapter: pi-rewind-hook claims `rewind` with localized statusBar title
    const rewindHook = resolveStatusPillAdapterByKey('rewind')
    expect(rewindHook?.id).toBe('pi-rewind-hook')
    expect(rewindHook?.statusBar?.protocol).toBe('status-pill-v1')
    expect(resolveAdapterText(rewindHook!, 'zh').statusBar.title).toBe('Rewind 快照')
    expect(resolveAdapterText(rewindHook!, 'en').statusBar.title).toBe('Rewind Snapshots')
    expect(resolveAdapterText(rewindHook!, 'ru').statusBar.title).toBe('Снимки Rewind')

    // All 43 builtin declarations pass schema validation and expose exact 23 Group A install specs
    for (const raw of BUILTIN_ADAPTERS) {
      const parsed = parseAdapterDeclaration(raw)
      expect('adapter' in parsed, `failed validation for ${raw.id}`).toBe(true)
    }
    const installable = BUILTIN_ADAPTERS.filter((a) => Boolean(a.install?.source))
    expect(installable).toHaveLength(23)
    expect(installable.some((a) => a.id === 'pi-continue')).toBe(false)
    expect(installable.some((a) => a.id === 'trellis')).toBe(false)
    expect(installable.some((a) => a.id === 'pi-rewind')).toBe(false)

    // Rejects unsafe install.source strings
    expect(
      'error' in
        parseAdapterDeclaration({
          id: 'bad-pkg',
          tier: 'headless',
          match: { names: ['bad-pkg'] },
          install: { source: 'npm:foo; rm -rf /' },
        }),
    ).toBe(true)
  })

  it('validates status-pill-v1, background-jobs-v1, and interact.defaults strictly', () => {
    const validPill = parseAdapterDeclaration({
      id: 'my-goal-pill',
      tier: 'partial',
      match: { names: ['my-goal-pill'] },
      statusBar: {
        protocol: 'status-pill-v1',
        statusKeys: ['goal-progress'],
        icon: 'Target',
        title: 'Goal',
        clickAction: { type: 'slash', command: '/goal-status' },
      },
    })
    expect('adapter' in validPill).toBe(true)

    // Rejects directory traversal in logFile.dirName
    const badLogDir = parseAdapterDeclaration({
      id: 'bad-bg',
      tier: 'partial',
      match: { names: ['bad-bg'] },
      statusBar: {
        protocol: 'background-jobs-v1',
        tools: ['job_run'],
        logFile: { dirName: '../etc', filePattern: '^.*$' },
      },
    })
    expect('error' in badLogDir).toBe(true)

    // Rejects status-pill-v1 without statusKeys
    const missingKeys = parseAdapterDeclaration({
      id: 'bad-pill',
      tier: 'partial',
      match: { names: ['bad-pill'] },
      statusBar: { protocol: 'status-pill-v1' },
    })
    expect('error' in missingKeys).toBe(true)

    // Rejects slash clickAction without command
    const missingCmd = parseAdapterDeclaration({
      id: 'bad-click',
      tier: 'partial',
      match: { names: ['bad-click'] },
      statusBar: {
        protocol: 'status-pill-v1',
        statusKeys: ['k'],
        clickAction: { type: 'slash' },
      },
    })
    expect('error' in missingCmd).toBe(true)
  })

  it('reconstructs jobs and validates log paths using arbitrary custom adapter specs (zero package hardcoding)', () => {
    const customSpec = {
      adapterId: 'custom-runner',
      tools: ['job_start', 'job_poll', 'job_stop'],
      exitMessageTypes: ['job-finished'],
      statusKeys: ['custom-runner-status'],
      inspectTool: 'job_poll',
      killTool: 'job_stop',
      logFile: { dirName: 'custom-jobs', filePattern: '^job_\\d+\\.log$' },
      fields: { id: 'jobId', command: 'cmd', outputPath: 'logFile' } as const,
    }

    const entries = [
      {
        type: 'message',
        timestamp: '2026-11-19T10:00:00.000Z',
        message: {
          role: 'toolResult',
          toolName: 'job_start',
          details: {
            jobId: 'job_42',
            cmd: 'cargo test',
            status: 'running',
            exitCode: null,
            createdAt: '2026-11-19T10:00:00.000Z',
            logFile: '/tmp/custom-jobs/job_42.log',
          },
        },
      },
      {
        type: 'custom_message',
        customType: 'job-finished',
        timestamp: '2026-11-19T10:00:15.000Z',
        details: {
          jobId: 'job_42',
          cmd: 'cargo test',
          status: 'exited',
          exitCode: 0,
          createdAt: '2026-11-19T10:00:00.000Z',
          logFile: '/tmp/custom-jobs/job_42.log',
          lineCount: 88,
          tail: 'test result: ok.\n',
        },
      },
    ]

    const list = extractBackgroundTasksFromBranchEntries(entries, '/s.jsonl', [customSpec])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'job_42',
      command: 'cargo test',
      status: 'exited',
      exitCode: 0,
      adapterId: 'custom-runner',
      outputPath: '/tmp/custom-jobs/job_42.log',
    })
    expect(list[0].updatedAt - list[0].createdAt).toBe(15_000)

    expect(isSafeBackgroundLogPath('/tmp/custom-jobs/job_42.log', [customSpec.logFile])).toBe(true)
    expect(isSafeBackgroundLogPath('/tmp/pi-background-terminal/bg_1234.log', [customSpec.logFile])).toBe(false)
  })
})
