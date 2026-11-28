// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { SshManagerCore } from './ssh-panel'

const invokeMock = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: {
    invoke: (...args: unknown[]) => invokeMock(...args),
  },
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn().mockResolvedValue(undefined),
}))

describe('SshManagerCore', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'ssh.listHosts') {
        return {
          hosts: [
            {
              host: 'my-vps',
              label: '生产 VPS',
              hostName: '203.0.113.10',
              user: 'root',
              port: 22,
              remotePath: '/root/app',
              source: 'config',
              enabled: false,
            },
          ],
          activeHost: null,
        }
      }
      if (channel === 'ssh.connect') {
        return {
          ok: true,
          enabled: true,
          activeHost: 'my-vps',
          runtime: { mode: 'wsl', distro: 'ssh@my-vps' },
          workspacePath: '\\\\wsl.localhost\\ssh@my-vps\\root\\app',
          hosts: [
            {
              host: 'my-vps',
              label: '生产 VPS',
              hostName: '203.0.113.10',
              user: 'root',
              port: 22,
              remotePath: '/root/app',
              source: 'config',
              enabled: true,
            },
          ],
        }
      }
      if (channel === 'ssh.probeHost') {
        return {
          result: {
            ok: true,
            distro: 'ssh@my-vps',
            node: true,
            nodeVersion: '22.19.0',
            nodePath: '/usr/bin/node',
            npm: true,
            git: true,
            pi: true,
            sdk: true,
            sdkVersion: '0.67.2',
            sdkPath: '/usr/lib/node_modules/@earendil-works/pi-coding-agent',
            home: '/root',
            shell: '/bin/bash',
          },
        }
      }
      return {}
    })
  })

  it('renders discovered SSH hosts and toggles connection via switch', async () => {
    const onSynced = vi.fn()
    const { getByText, getByRole } = render(<SshManagerCore onRuntimeSynced={onSynced} />)

    await waitFor(() => {
      expect(getByText('生产 VPS')).toBeTruthy()
    })

    const toggle = getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('ssh.connect', {
        host: 'my-vps',
        enabled: true,
        remotePath: '/root/app',
      })
      expect(onSynced).toHaveBeenCalledWith({ mode: 'wsl', distro: 'ssh@my-vps' })
    })
  })
})
