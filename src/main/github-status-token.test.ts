import { describe, expect, it, vi } from 'vitest'

vi.mock('./git-workspace', () => ({ runGitReadOnly: vi.fn() }))

import { envGitHubTokenForHost } from './github-status'

describe('envGitHubTokenForHost', () => {
  const env = { GH_TOKEN: ' gh-secret ' } as NodeJS.ProcessEnv

  it('uses the environment token for github.com and GitHub-hosted *.ghe.com', () => {
    expect(envGitHubTokenForHost('github.com', env)).toBe('gh-secret')
    expect(envGitHubTokenForHost('GitHub.com', env)).toBe('gh-secret')
    expect(envGitHubTokenForHost('acme.ghe.com', env)).toBe('gh-secret')
    expect(envGitHubTokenForHost('github.com', { GITHUB_TOKEN: 'fallback' } as NodeJS.ProcessEnv)).toBe('fallback')
  })

  it('never hands the environment token to a host taken from an arbitrary remote URL', () => {
    for (const host of ['github.attacker.net', 'notgithub.com', 'github.com.evil.io', 'github.acme.internal']) {
      expect(envGitHubTokenForHost(host, env)).toBeNull()
    }
  })

  it('returns null when no token is set', () => {
    expect(envGitHubTokenForHost('github.com', {} as NodeJS.ProcessEnv)).toBeNull()
  })
})
