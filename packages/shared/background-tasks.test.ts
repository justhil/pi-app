import { describe, expect, it } from 'vitest'
import {
  extractBackgroundTasksFromBranchEntries,
  isSafeBackgroundLogPath,
  mergeBackgroundTask,
  parseBackgroundTaskDetails,
} from './background-tasks'

describe('background-tasks shared helpers', () => {
  it('parses single and batch task payloads and reconstructs latest state from branch history', () => {
    const entries = [
      {
        type: 'message',
        timestamp: '2026-11-19T00:00:01.000Z',
        message: {
          role: 'toolResult',
          toolName: 'background_run',
          details: {
            id: 'bg_aaa111',
            command: 'npm run build',
            status: 'running',
            exitCode: null,
            createdAt: '2026-11-19T00:00:00.000Z',
            outputPath: 'C:\\Temp\\pi-background-terminal\\bg_aaa111.log',
            lineCount: 0,
            tail: '',
            timeoutSeconds: 600,
          },
        },
      },
      {
        type: 'message',
        timestamp: '2026-11-19T00:00:05.000Z',
        message: {
          role: 'toolResult',
          toolName: 'background_status',
          details: {
            id: 'bg_aaa111',
            command: 'npm run build',
            status: 'running',
            exitCode: null,
            createdAt: '2026-11-19T00:00:00.000Z',
            outputPath: 'C:\\Temp\\pi-background-terminal\\bg_aaa111.log',
            lineCount: 42,
            tail: 'building...\n',
          },
        },
      },
      {
        type: 'custom_message',
        customType: 'background-exit',
        timestamp: '2026-11-19T00:00:10.000Z',
        details: {
          id: 'bg_aaa111',
          command: 'npm run build',
          status: 'exited',
          exitCode: 0,
          createdAt: '2026-11-19T00:00:00.000Z',
          outputPath: 'C:\\Temp\\pi-background-terminal\\bg_aaa111.log',
          lineCount: 120,
          tail: 'done\n',
        },
      },
    ]

    const list = extractBackgroundTasksFromBranchEntries(entries, '/sessions/s1.jsonl')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'bg_aaa111',
      command: 'npm run build',
      status: 'exited',
      exitCode: 0,
      lineCount: 120,
      tail: 'done\n',
      timeoutSeconds: 600,
      sessionFile: '/sessions/s1.jsonl',
    })
    // Historical duration uses entry timestamp (10s), never Date.now()
    expect(list[0].updatedAt - list[0].createdAt).toBe(10_000)

    // Does not revert a settled task back to running with stale timestamp
    const staleRunning = parseBackgroundTaskDetails({
      id: 'bg_aaa111',
      command: 'npm run build',
      status: 'running',
      exitCode: null,
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-19T00:00:03.000Z',
      lineCount: 10,
      tail: '',
    })[0]
    expect(mergeBackgroundTask(list[0], staleRunning).status).toBe('exited')
  })

  it('validates background terminal log paths strictly', () => {
    expect(isSafeBackgroundLogPath('C:\\Users\\Admin\\AppData\\Local\\Temp\\pi-background-terminal\\bg_998ab6b746e1f742.log')).toBe(true)
    expect(isSafeBackgroundLogPath('/tmp/pi-background-terminal/bg_abcdef01.log')).toBe(true)
    expect(isSafeBackgroundLogPath('/tmp/pi-background-terminal/../etc/passwd')).toBe(false)
    expect(isSafeBackgroundLogPath('/tmp/other/bg_abcdef01.log')).toBe(false)
    expect(isSafeBackgroundLogPath('/tmp/pi-background-terminal/secrets.txt')).toBe(false)
  })
})
