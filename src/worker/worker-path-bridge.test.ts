import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('worker-path-bridge', () => {
  it('converts Windows drive paths to WSL paths', async () => {
    vi.stubEnv('PI_WSL_DISTRO', 'Debian')
    vi.resetModules()

    const bridge = await import('./worker-path-bridge')

    expect(bridge.toWorkerPath('C:\\Users\\T\\workspace')).toBe('/mnt/c/Users/T/workspace')
    expect(
      bridge.translateIncomingPaths({
        type: 'init',
        cwd: 'C:\\Users\\T\\workspace',
        untouched: 'C:\\Users\\T\\other',
      }),
    ).toEqual({
      type: 'init',
      cwd: '/mnt/c/Users/T/workspace',
      untouched: 'C:\\Users\\T\\other',
    })
  })

  it('translates session row paths to Windows view on outgoing responses', async () => {
    vi.stubEnv('PI_WSL_DISTRO', 'Debian')
    vi.resetModules()

    const bridge = await import('./worker-path-bridge')

    const out = bridge.translateOutgoingPaths({
      type: 'listSessions-done',
      sessions: [
        {
          id: 's1',
          path: '/root/proj/.pi/agent/sessions/s1/session.jsonl',
          cwd: '/root/proj',
        },
      ],
    })
    expect((out.sessions as Record<string, unknown>[])[0].path).toBe(
      '\\\\wsl.localhost\\Debian\\root\\proj\\.pi\\agent\\sessions\\s1\\session.jsonl',
    )
    expect((out.sessions as Record<string, unknown>[])[0].cwd).toBe(
      '\\\\wsl.localhost\\Debian\\root\\proj',
    )
  })

  it('translates /mnt/c sandbox session rows back to Windows drive paths', async () => {
    vi.stubEnv('PI_WSL_DISTRO', 'Debian')
    vi.resetModules()

    const bridge = await import('./worker-path-bridge')

    const out = bridge.translateOutgoingPaths({
      type: 'listSessions-done',
      sessions: [
        {
          id: 'sb1',
          path: '/mnt/c/Users/T/AppData/Roaming/pi-desktop/sandbox-workspaces/abc/sb.jsonl',
          cwd: '/mnt/c/Users/T/AppData/Roaming/pi-desktop/sandbox-workspaces/abc',
        },
      ],
    })
    expect((out.sessions as Record<string, unknown>[])[0].path).toBe(
      'C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\abc\\sb.jsonl',
    )
    expect((out.sessions as Record<string, unknown>[])[0].cwd).toBe(
      'C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\abc',
    )
  })
})
