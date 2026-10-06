import { describe, expect, it } from 'vitest'
import { detectProfiles, parseWslList } from '../shell-profiles'

const env = (over: Partial<Parameters<typeof detectProfiles>[1]> & { files: string[] }) => ({
  platform: 'linux' as NodeJS.Platform,
  env: {},
  exists: (p: string) => over.files.includes(p),
  which: () => null,
  wslDistros: () => [],
  etcShells: () => [],
  ...over,
})

describe('detectProfiles', () => {
  it('puts pi\'s shell first and lists login shells from /etc/shells', () => {
    const out = detectProfiles('/bin/bash', env({ files: ['/bin/bash', '/usr/bin/zsh', '/usr/bin/fish', '/bin/sh'], env: { SHELL: '/usr/bin/fish' }, etcShells: () => ['/bin/bash', '/usr/bin/zsh', '/usr/bin/fish', '/usr/bin/git-shell'] }))
    expect(out.map((p) => [p.name, p.path, p.args, !!p.piDefault])).toEqual([
      ['bash', '/bin/bash', ['-l'], true],
      ['fish', '/usr/bin/fish', ['-l'], false],
      ['zsh', '/usr/bin/zsh', ['-l'], false],
      ['sh', '/bin/sh', ['-l'], false],
    ])
  })

  it('on Windows: Git Bash (pi default), pwsh 7, Windows PowerShell, cmd and WSL distros', () => {
    const files = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Windows\\System32\\wsl.exe',
    ]
    const out = detectProfiles(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      env({ platform: 'win32', files, env: { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, which: (e) => (e === 'pwsh.exe' ? files[1] : null), wslDistros: () => ['Ubuntu-24.04'] }),
    )
    expect(out.map((p) => [p.name, p.kind, p.args])).toEqual([
      ['Git Bash', 'bash', ['--login', '-i']],
      ['PowerShell 7', 'pwsh', ['-NoLogo']],
      ['Windows PowerShell', 'powershell', ['-NoLogo']],
      ['Command Prompt', 'cmd', []],
      ['WSL · Ubuntu-24.04', 'wsl', ['-d', 'Ubuntu-24.04', '--cd', '~']],
    ])
  })

  it('lists a binary once when /bin links to /usr/bin', () => {
    const out = detectProfiles('/bin/bash', env({ files: ['/bin/bash', '/usr/bin/bash', '/usr/bin/zsh', '/bin/zsh'], realpath: (p: string) => p.replace(/^\/bin\//, '/usr/bin/'), etcShells: () => ['/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh'] }))
    expect(out.map((p) => p.path)).toEqual(['/bin/bash', '/bin/zsh'])
  })

  it('skips a pi shell that does not exist', () => {
    expect(detectProfiles('/nope/bash', env({ files: ['/bin/sh'] })).map((p) => p.path)).toEqual(['/bin/sh'])
  })
})

describe('parseWslList', () => {
  it('decodes UTF-16LE output and drops docker distros', () => {
    const raw = Buffer.from('\uFEFFUbuntu\r\ndocker-desktop\r\nDebian\r\n', 'utf16le')
    expect(parseWslList(raw)).toEqual(['Ubuntu', 'Debian'])
  })
})
