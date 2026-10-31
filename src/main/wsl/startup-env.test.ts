import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runWslAsync: vi.fn() }))
vi.mock('./wsl-exec', () => ({
  isValidWslDistroName: () => true,
  runWslAsync: mocks.runWslAsync,
}))
import { awaitWslVm, bindWslPersistence, forgetWslEnv, getCachedWslEnv, resolveWslEnv, startWslVm } from './wsl-env'

it('should_capture_environment_before_unc_handlers_when_wsl_starts_without_cache', async () => {
  bindWslPersistence(null)
  forgetWslEnv()
  mocks.runWslAsync.mockImplementation(async (args: string[]) => ({
    status: 0,
    stdout: args.includes('true') ? '' : 'HOME=/home/u\nPATH=/home/u/.local/bin:/usr/bin\nNODE=/usr/bin/node\nSHELL=/bin/bash\nMODE=login\n',
    stderr: '',
  }))
  await startWslVm('StartupTest')
  await awaitWslVm()
  expect(getCachedWslEnv('StartupTest')?.home).toBe('/home/u')
})

it('should_run_timeout_in_foreground_with_kill_escalation_when_capturing_interactive_shell_env', async () => {
  bindWslPersistence(null)
  forgetWslEnv()
  let capturedScript = ''
  mocks.runWslAsync.mockImplementation(async (_args: string[], opts?: { input?: string }) => {
    if (opts?.input) capturedScript = opts.input
    return {
      status: 0,
      stdout: 'HOME=/home/u\nPATH=/usr/bin\nSHELL=/bin/bash\nMODE=interactive-login\n',
      stderr: '',
    }
  })

  await resolveWslEnv('Ubuntu', { force: true })

  expect(capturedScript).toContain('timeout --foreground -k 2 10 "$@"')
})
