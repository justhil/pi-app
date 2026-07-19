import { describe, expect, it } from 'vitest'
import { mergeLoginShellEnvironment } from '../login-shell-environment'

describe('macOS login shell environment merge', () => {
  it('should_import_missing_login_shell_variables_when_gui_environment_is_sparse', () => {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: {
        PATH: '/usr/bin:/bin',
        PI_E2E: '1',
      },
      loginShellEnvironment: {
        PATH: '/Users/test/.nvm/versions/node/v22/bin:/usr/bin:/bin',
        CPA_API_KEY: 'secret-value',
        NVM_DIR: '/Users/test/.nvm',
        HTTPS_PROXY: 'http://proxy.example',
      },
      pathDelimiter: ':',
    })

    expect(mergedEnvironment.CPA_API_KEY).toBe('secret-value')
    expect(mergedEnvironment.NVM_DIR).toBe('/Users/test/.nvm')
    expect(mergedEnvironment.HTTPS_PROXY).toBe('http://proxy.example')
    expect(mergedEnvironment.PATH).toBe(
      '/Users/test/.nvm/versions/node/v22/bin:/usr/bin:/bin',
    )
    expect(mergedEnvironment.PI_E2E).toBe('1')
  })

  it('should_preserve_launch_values_when_login_shell_defines_conflicts', () => {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: {
        PATH: '/application/bin:/usr/bin',
        CPA_API_KEY: 'launch-value',
        EMPTY_OVERRIDE: '',
      },
      loginShellEnvironment: {
        PATH: '/shell/bin:/usr/bin',
        CPA_API_KEY: 'shell-value',
        EMPTY_OVERRIDE: 'shell-value',
      },
      pathDelimiter: ':',
    })

    expect(mergedEnvironment.CPA_API_KEY).toBe('launch-value')
    expect(mergedEnvironment.EMPTY_OVERRIDE).toBe('')
    expect(mergedEnvironment.PATH).toBe('/shell/bin:/usr/bin:/application/bin')
  })

  it('should_drop_shell_capture_and_electron_control_variables_when_merging', () => {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: { PATH: '/usr/bin' },
      loginShellEnvironment: {
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_CHANNEL_FD: '42',
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
        PWD: '/Users/test',
        SAFE_PROVIDER_KEY: 'safe-value',
      },
      pathDelimiter: ':',
    })

    expect(mergedEnvironment.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(mergedEnvironment.NODE_CHANNEL_FD).toBeUndefined()
    expect(mergedEnvironment.DISABLE_AUTO_UPDATE).toBeUndefined()
    expect(mergedEnvironment.ZSH_TMUX_AUTOSTARTED).toBeUndefined()
    expect(mergedEnvironment.PWD).toBeUndefined()
    expect(mergedEnvironment.SAFE_PROVIDER_KEY).toBe('safe-value')
  })
})
