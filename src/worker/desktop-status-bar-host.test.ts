import { describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { installAdapterCatalog } from '../extension-compat/adapter-loader'
import { createDesktopStatusBarHost } from './desktop-status-bar-host'

describe('DesktopStatusBarHost', () => {
  it('routes background-jobs-v1 tools/messages and status-pill-v1 keys purely from installed adapters', async () => {
    const projectDir = '/virtual-status-host-proj'
    installAdapterCatalog(projectDir, {
      revision: 'test-1',
      scope: projectDir,
      errors: [],
      sources: { 'custom-bg': 'override', 'custom-pill': 'override' },
      adapters: [
        {
          id: 'custom-bg',
          tier: 'native',
          match: { names: ['custom-bg'], tools: ['job_run', 'job_status', 'job_kill'] },
          statusBar: {
            protocol: 'background-jobs-v1',
            icon: 'Terminal',
            title: 'Jobs',
            tools: ['job_run', 'job_status', 'job_kill'],
            exitMessageTypes: ['job-done'],
            statusKeys: ['custom-bg-key'],
            actions: { inspectTool: 'job_status', killTool: 'job_kill' },
            logFile: { dirName: 'custom-bg-logs', filePattern: '^job_[a-z0-9]+\\.log$' },
          },
        },
        {
          id: 'custom-pill',
          tier: 'partial',
          match: { names: ['custom-pill'] },
          statusBar: {
            protocol: 'status-pill-v1',
            statusKeys: ['goal-stat'],
            icon: 'Target',
            title: 'Goal',
            clickAction: { type: 'slash', command: '/goal-status' },
          },
        },
      ],
    })

    const emitted: AppEvent[] = []
    const killExecute = vi.fn().mockResolvedValue({
      details: {
        id: 'job_1',
        command: 'npm test',
        status: 'killed',
        exitCode: null,
        createdAt: 1000,
        lineCount: 5,
        tail: 'stopped',
      },
    })
    const fakeSession = {
      sessionManager: { getSessionFile: () => '/sessions/s1.jsonl' },
      _toolRegistry: new Map([
        ['job_run', { name: 'job_run', execute: vi.fn() }],
        ['job_kill', { name: 'job_kill', execute: killExecute }],
      ]),
    }

    const host = createDesktopStatusBarHost({
      emit: (e) => emitted.push(e),
      baseEvent: () => ({ seq: 1, sessionId: 's1', sessionFile: '/sessions/s1.jsonl', timestamp: 1 }),
      getSession: () => fakeSession as never,
      projectDir,
    })

    // 1. Captures custom background-jobs-v1 tool execution and reports hasActiveAdapter=true
    host.captureTool('job_run', {
      id: 'job_1',
      command: 'npm test',
      status: 'running',
      exitCode: null,
      createdAt: 1000,
      lineCount: 0,
      tail: '',
    })
    expect(emitted.at(-1)).toMatchObject({
      type: 'background_tasks',
      hasActiveAdapter: true,
      adapterId: 'custom-bg',
      icon: 'Terminal',
      title: 'Jobs',
    })

    // 2. Kills via adapter-declared actions.killTool
    const killRes = await host.killTask('job_1')
    expect(killExecute).toHaveBeenCalledWith('desktop-kill-job_1', { id: 'job_1' })
    expect(killRes.ok).toBe(true)
    expect(killRes.task?.status).toBe('killed')

    // 3. Projects claimed status-pill-v1 keys (stripping ANSI) and ignores unclaimed keys
    const countBefore = emitted.length
    host.setStatus('unclaimed-ext', 'noise')
    expect(emitted).toHaveLength(countBefore)

    host.setStatus('goal-stat', '\x1b[32mGoal 2/5\x1b[0m')
    expect(emitted.at(-1)).toMatchObject({
      type: 'extension_status',
      phase: 'set',
      adapterId: 'custom-pill',
      statusKey: 'goal-stat',
      text: 'Goal 2/5',
      icon: 'Target',
      clickAction: { type: 'slash', command: '/goal-status' },
    })

    host.setStatus('goal-stat', undefined)
    expect(emitted.at(-1)).toMatchObject({
      type: 'extension_status',
      phase: 'clear',
      adapterId: 'custom-pill',
      statusKey: 'goal-stat',
    })

    host.dispose()
  })
})
