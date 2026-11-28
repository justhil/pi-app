import { afterEach, describe, expect, it } from 'vitest'
import { bindSshPersistence, isValidSshHost, parseSshConfigText } from '../ssh/ssh-config'
import { buildSshCliArgs, buildSshRemoteCommand, quotePosixArg } from '../ssh/ssh-exec'

afterEach(() => bindSshPersistence(null))

describe('ssh-config & ssh-exec', () => {
  it('parses concrete Host entries from OpenSSH config and ignores wildcards', () => {
    const sample = `
      # Global defaults
      Host *
        ServerAliveInterval 30

      Host dev-vps prod-box
        HostName 203.0.113.10
        User ubuntu
        Port 2222
        IdentityFile ~/.ssh/id_ed25519

      Host *.internal.corp
        User admin
    `
    const parsed = parseSshConfigText(sample)
    expect(parsed).toEqual([
      {
        host: 'dev-vps',
        hostName: '203.0.113.10',
        user: 'ubuntu',
        port: 2222,
        identityFile: '~/.ssh/id_ed25519',
      },
      {
        host: 'prod-box',
        hostName: '203.0.113.10',
        user: 'ubuntu',
        port: 2222,
        identityFile: '~/.ssh/id_ed25519',
      },
    ])
  })

  it('validates SSH host strings safely', () => {
    expect(isValidSshHost('my-vps')).toBe(true)
    expect(isValidSshHost('root@192.168.1.10')).toBe(true)
    expect(isValidSshHost('bad host; rm -rf')).toBe(false)
    expect(isValidSshHost('-F')).toBe(false)
    expect(isValidSshHost('root@-F')).toBe(false)
    expect(isValidSshHost('')).toBe(false)
  })

  it('passes saved connection overrides before the end-of-options marker', () => {
    bindSshPersistence({
      readHosts: () => [{ host: 'dev-vps', hostName: '203.0.113.10', user: 'ubuntu', port: 2222 }],
      writeHosts: () => {},
      activeHost: () => null,
    })
    expect(buildSshCliArgs('ssh@dev-vps').slice(-8)).toEqual([
      '-o', 'HostName=203.0.113.10', '-l', 'ubuntu', '-p', '2222', '--', 'dev-vps',
    ])
  })

  it('rejects an option in a saved hostname before invoking OpenSSH', () => {
    bindSshPersistence({
      readHosts: () => [{ host: 'dev-vps', hostName: '-oProxyCommand=unexpected' }],
      writeHosts: () => {},
      activeHost: () => null,
    })
    expect(() => buildSshCliArgs('ssh@dev-vps')).toThrow('Invalid SSH hostname')
    expect(() => buildSshCliArgs('ssh@-F')).toThrow('Invalid SSH host')
  })

  it('quotes POSIX arguments and builds remote commands with cwd and env', () => {
    expect(quotePosixArg("a'b")).toBe("'a'\\''b'")
    const cmd = buildSshRemoteCommand('/root/my project', ['git', 'for-each-ref', '--format=%(refname)'], {
      PI_WORKER_STDIO: '1',
    })
    expect(cmd).toBe(
      "cd -- '/root/my project' && 'env' 'PI_WORKER_STDIO=1' 'git' 'for-each-ref' '--format=%(refname)'",
    )
    expect(buildSshRemoteCommand('/', ['pwd'])).toBe("cd -- '/' && 'pwd'")
  })
})
