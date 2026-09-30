import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runWslAsync: vi.fn() }))
vi.mock('./wsl-exec', () => ({
  isValidWslDistroName: () => true,
  runWslAsync: mocks.runWslAsync,
}))
import { awaitWslVm, bindWslPersistence, forgetWslEnv, getCachedWslEnv, startWslVm } from './wsl-env'

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
