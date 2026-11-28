import { describe, expect, it } from 'vitest'
import {
  isSshDistro,
  isSshWindowsPath,
  isWslWindowsPath,
  sshDistroHost,
  toSshDistro,
  wslWindowsPathDistro,
  wslPathToWindows,
  windowsPathToWsl,
  normalizeWslWindowsPath,
  wslWindowsPathsEqual,
} from './wsl-path'

describe('wsl-path', () => {
  describe('isWslWindowsPath', () => {
    it('detects wsl.localhost and legacy wsl$ UNC', () => {
      expect(isWslWindowsPath('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj')).toBe(true)
      expect(isWslWindowsPath('\\\\wsl$\\Ubuntu\\home\\u\\proj')).toBe(true)
      expect(isWslWindowsPath('C:\\Users\\u\\proj')).toBe(false)
      expect(isWslWindowsPath('/home/u/proj')).toBe(false)
      expect(isWslWindowsPath(null)).toBe(false)
      expect(isWslWindowsPath('')).toBe(false)
    })
  })

  describe('wslWindowsPathDistro', () => {
    it('extracts distro name', () => {
      expect(wslWindowsPathDistro('\\\\wsl.localhost\\Ubuntu\\home\\u')).toBe('Ubuntu')
      expect(wslWindowsPathDistro('\\\\wsl$\\Debian-12\\etc')).toBe('Debian-12')
      expect(wslWindowsPathDistro('\\\\wsl.localhost\\archlinux\\home')).toBe('archlinux')
    })
    it('returns null for non-WSL paths', () => {
      expect(wslWindowsPathDistro('C:\\x')).toBeNull()
      expect(wslWindowsPathDistro('\\\\other\\share\\x')).toBeNull()
      expect(wslWindowsPathDistro('//wsl.localhost')).toBeNull()
    })
  })

  describe('wslPathToWindows', () => {
    it('maps /home to UNC with distro', () => {
      expect(wslPathToWindows('Ubuntu', '/home/u/proj')).toBe(
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj',
      )
    })
    it('maps /mnt/<drive> to drive letter', () => {
      expect(wslPathToWindows('Ubuntu', '/mnt/c/Users/u/x')).toBe('C:\\Users\\u\\x')
      expect(wslPathToWindows('Ubuntu', '/mnt/d')).toBe('D:\\')
    })
    it('handles backslash input and returns Windows paths unchanged', () => {
      expect(wslPathToWindows('Ubuntu', '\\home\\u\\proj')).toBe(
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj',
      )
      expect(wslPathToWindows('Ubuntu', 'C:\\Users\\u')).toBe('C:\\Users\\u')
      expect(wslPathToWindows('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\u')).toBe(
        '\\\\wsl.localhost\\Ubuntu\\home\\u',
      )
    })
    it('returns input unchanged when no distro and not /mnt', () => {
      expect(wslPathToWindows(null, '/home/u/proj')).toBe('/home/u/proj')
    })
  })

  describe('windowsPathToWsl', () => {
    it('maps UNC to WSL absolute', () => {
      expect(windowsPathToWsl('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj')).toBe(
        '/home/u/proj',
      )
      expect(windowsPathToWsl('Ubuntu', '\\\\wsl$\\Debian-12\\etc\\nginx')).toBe('/etc/nginx')
    })
    it('maps drive letter to /mnt', () => {
      expect(windowsPathToWsl('Ubuntu', 'C:\\Users\\u\\x')).toBe('/mnt/c/Users/u/x')
      expect(windowsPathToWsl('Ubuntu', 'D:\\')).toBe('/mnt/d')
    })
    it('returns non-Windows input unchanged', () => {
      expect(windowsPathToWsl('Ubuntu', '/home/u/proj')).toBe('/home/u/proj')
    })
  })

  describe('normalizeWslWindowsPath', () => {
    it('normalizes slashes and distro to localhost form', () => {
      expect(normalizeWslWindowsPath('\\\\wsl$\\Ubuntu\\home\\u\\proj\\')).toBe(
        '//wsl.localhost/Ubuntu/home/u/proj',
      )
      expect(normalizeWslWindowsPath('\\\\wsl.localhost\\ubuntu\\home\\u')).toBe(
        '//wsl.localhost/ubuntu/home/u',
      )
    })
    it('passes through non-UNC paths', () => {
      expect(normalizeWslWindowsPath('C:\\x')).toBe('C:\\x')
    })
  })

  describe('wslWindowsPathsEqual', () => {
    it('compares with slash/case/trailing-slash normalization', () => {
      expect(
        wslWindowsPathsEqual('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj', '//wsl.localhost/Ubuntu/home/u/proj/'),
      ).toBe(true)
      expect(
        wslWindowsPathsEqual('\\\\wsl$\\Ubuntu\\home\\u\\proj', '\\\\wsl.localhost\\Ubuntu\\home\\u\\other'),
      ).toBe(false)
      expect(wslWindowsPathsEqual('C:\\a', 'c:\\a')).toBe(false)
    })
  })

  describe('SSH target paths', () => {
    it('identifies ssh@ distros and extracts host', () => {
      expect(toSshDistro('my-vps')).toBe('ssh@my-vps')
      expect(isSshDistro('ssh@my-vps')).toBe(true)
      expect(isSshDistro('Ubuntu')).toBe(false)
      expect(sshDistroHost('ssh@root@1.2.3.4')).toBe('root@1.2.3.4')
    })

    it('maps remote VPS paths without converting /mnt/<drive> to local Windows drives', () => {
      const win = wslPathToWindows('ssh@my-vps', '/root/my-project')
      expect(win).toBe('\\\\wsl.localhost\\ssh@my-vps\\root\\my-project')
      expect(isSshWindowsPath(win)).toBe(true)
      expect(windowsPathToWsl('ssh@my-vps', win)).toBe('/root/my-project')
      expect(wslPathToWindows('ssh@my-vps', '/mnt/c/data')).toBe('\\\\wsl.localhost\\ssh@my-vps\\mnt\\c\\data')
    })

    it('rejects another SSH host or a Windows path instead of resolving it on the active host', () => {
      const otherHost = '//WSL.LOCALHOST/ssh@other-vps/root/project'
      expect(() => windowsPathToWsl('ssh@my-vps', otherHost)).toThrow('different SSH runtime')
      expect(() => windowsPathToWsl('Ubuntu', otherHost)).toThrow('different SSH runtime')
      expect(() => windowsPathToWsl('ssh@my-vps', 'C:\\project')).toThrow('unavailable on the SSH runtime')
      expect(windowsPathToWsl('ssh@my-vps', '//wsl.localhost/ssh@my-vps')).toBe('/')
    })
  })
})
