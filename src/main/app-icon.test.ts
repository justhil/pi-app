import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { appIconCandidates } from './app-icon'

describe('app icon paths', () => {
  it('prefers the packaged Windows ICO path shipped by electron-builder', () => {
    expect(appIconCandidates('win32', 'C:/app/resources', 'C:/app/out/main')[0]).toBe(
      join('C:/app/resources', 'build', 'icon.ico'),
    )
  })

  it('keeps the development Windows ICO path before PNG fallbacks', () => {
    expect(appIconCandidates('win32', 'C:/electron/resources', 'D:/pi/out/main')[1]).toBe(
      join('D:/pi/out/main', '../../build/icon.ico'),
    )
  })
})
