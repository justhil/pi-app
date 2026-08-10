import { describe, expect, it } from 'vitest'
import {
  isWslWindowsPath,
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
})
