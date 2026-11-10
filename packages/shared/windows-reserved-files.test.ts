import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isWindowsReservedDeviceName,
  removeWindowsReservedDeviceFiles,
  toWindowsLiteralPath,
} from './windows-reserved-files'

describe('windows-reserved-files', () => {
  it('should_detect_windows_reserved_device_names_case_insensitively', () => {
    expect(isWindowsReservedDeviceName('nul')).toBe(true)
    expect(isWindowsReservedDeviceName('NUL')).toBe(true)
    expect(isWindowsReservedDeviceName('con')).toBe(true)
    expect(isWindowsReservedDeviceName('prn')).toBe(true)
    expect(isWindowsReservedDeviceName('aux')).toBe(true)
    expect(isWindowsReservedDeviceName('nul.txt')).toBe(true)
    expect(isWindowsReservedDeviceName('nullable.ts')).toBe(false)
    expect(isWindowsReservedDeviceName('index.ts')).toBe(false)
  })

  it('should_remove_stray_nul_files_from_workspace_directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-win-nul-test-'))
    try {
      const normalFile = path.join(dir, 'keep.txt')
      await writeFile(normalFile, 'keep')
      const nulLiteral = toWindowsLiteralPath(path.join(dir, 'nul'), 'win32')
      expect(nulLiteral.startsWith('\\\\?\\')).toBe(true)

      // Simulate a stray file matching reserved name filter via custom matcher in cross-platform test
      const fakeNul = path.join(dir, process.platform === 'win32' ? 'nul' : 'NUL')
      await writeFile(
        process.platform === 'win32' ? toWindowsLiteralPath(fakeNul, 'win32') : fakeNul,
        'stray redirect output',
      )

      const removed = await removeWindowsReservedDeviceFiles(dir, { forcePlatform: 'win32' })
      expect(removed.length).toBe(1)

      const remaining = await readdir(dir)
      expect(remaining).toEqual(['keep.txt'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
