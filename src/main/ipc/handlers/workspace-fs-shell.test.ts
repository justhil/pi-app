import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { registerWorkspaceFsHandlers } from './workspace-fs'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: { path: string }) => Promise<unknown>>(),
  runtime: { mode: 'wsl', distro: 'Ubuntu' },
}))
vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }))
vi.mock('../registry', () => ({
  registerHandlerWithSchema: (name: string, _schema: unknown, handler: (req: { path: string }) => Promise<unknown>) => mocks.handlers.set(name, handler),
}))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => mocks.runtime }))

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.mocked(shell.openPath).mockReset().mockResolvedValue('')
  vi.mocked(shell.showItemInFolder).mockReset()
  mocks.runtime.mode = 'wsl'
  registerWorkspaceFsHandlers()
})
afterEach(() => vi.restoreAllMocks())

describe('workspace shell file operations', () => {
  it.each([
    ['/home/user/output/实验报告.pdf', '\\\\wsl.localhost\\Ubuntu\\home\\user\\output\\实验报告.pdf'],
    ['/mnt/d/reports/实验报告.pdf', 'D:\\reports\\实验报告.pdf'],
    ['C:\\reports\\report.pdf', 'C:\\reports\\report.pdf'],
    ['\\\\wsl.localhost\\Debian\\home\\user\\report.pdf', '\\\\wsl.localhost\\Debian\\home\\user\\report.pdf'],
  ])('opens and reveals the host path for %s', async (path, expected) => {
    await expect(mocks.handlers.get('ipc:shell.openPath')!({ path })).resolves.toEqual({ ok: true })
    await mocks.handlers.get('ipc:shell.showItemInFolder')!({ path })
    expect(shell.openPath).toHaveBeenCalledWith(expected)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(expected)
  })

  it('surfaces shell failures instead of reporting success', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('File not found')
    await expect(mocks.handlers.get('ipc:shell.openPath')!({ path: '/home/user/missing.pdf' })).resolves.toEqual({ ok: false, error: 'File not found' })
  })

  it('preserves native Linux and host-runtime paths', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await mocks.handlers.get('ipc:shell.openPath')!({ path: '/home/user/report.pdf' })
    expect(shell.openPath).toHaveBeenLastCalledWith('/home/user/report.pdf')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    mocks.runtime.mode = 'host'
    await mocks.handlers.get('ipc:shell.openPath')!({ path: 'C:\\report.pdf' })
    expect(shell.openPath).toHaveBeenLastCalledWith('C:\\report.pdf')
  })
})
