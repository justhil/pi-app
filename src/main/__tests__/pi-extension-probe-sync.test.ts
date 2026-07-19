import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExtensionProbeResult } from '../../extension-compat/extension-probe'
import { applyPiSyncToExtensionProbes } from '../pi-extension-probe-sync'
import { setPiExtensionEnabled } from '../pi-package-resource-toggle'

describe('project extension settings patterns', () => {
  it('should_disable_project_extension_when_sdk_resolves_from_project_pi_root', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'pi-desktop-extension-toggle-'))
    const extensionDirectory = join(workspaceDirectory, '.pi', 'extensions', 'auto-trellis-init')
    const extensionEntryPath = join(extensionDirectory, 'index.ts')
    mkdirSync(extensionDirectory, { recursive: true })
    writeFileSync(extensionEntryPath, 'export default function activate() {}\n', 'utf8')

    const extensionProbe = {
      id: 'auto-trellis-init',
      name: 'auto-trellis-init',
      source: 'project',
      mainFilePath: extensionEntryPath,
      enabled: true,
    } as ExtensionProbeResult

    applyPiSyncToExtensionProbes(workspaceDirectory, [extensionProbe])

    expect(extensionProbe.toggleTarget).toEqual({
      kind: 'top-level',
      scope: 'project',
      absolutePath: extensionEntryPath,
      baseDir: join(workspaceDirectory, '.pi'),
    })

    const toggleResult = setPiExtensionEnabled(
      workspaceDirectory,
      extensionProbe.toggleTarget!,
      false,
    )
    const projectSettings = JSON.parse(
      readFileSync(join(workspaceDirectory, '.pi', 'settings.json'), 'utf8'),
    ) as { extensions?: string[] }

    expect(toggleResult).toEqual({ ok: true })
    expect(projectSettings.extensions).toContain('-extensions/auto-trellis-init/index.ts')
    expect(projectSettings.extensions).not.toContain('-auto-trellis-init/index.ts')
  })
})
