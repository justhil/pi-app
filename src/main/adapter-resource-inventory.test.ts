import { expect, it, vi } from 'vitest'
import type { ExtensionProbeResult } from '../extension-compat/extension-probe'
import { annotateExtensionInventory, applyRuntimeCapabilities } from './adapter-resource-inventory'

it('combines every loaded entry in a package and reports real load errors', () => {
  const probes = [
    { id: 'example', name: 'example', packageSource: 'npm:example@1.0.0', registeredTools: ['guessed'], registeredCommands: [] },
    { id: 'broken', name: 'broken', mainFilePath: '/project/broken.ts', registeredTools: ['guessed'], registeredCommands: [] },
  ].map((probe) => ({ ...probe, source: 'project' as const, hasUI: false, compatibility: 'headless' as const, enabled: true }))
  applyRuntimeCapabilities(probes, {
    extensions: [
      { path: '/agent/a.ts', source: 'npm:example@1.0.0', tools: ['first'], commands: ['one'] },
      { path: '/agent/b.ts', source: 'npm:example@1.0.0', tools: ['second', 'first'], commands: ['two'] },
    ],
    errors: [{ path: '/project/broken.ts', error: 'load failed' }],
  })
  expect(probes[0]).toMatchObject({ registeredTools: ['first', 'second'], registeredCommands: ['one', 'two'], capabilitySource: 'runtime', runtimeLoaded: true })
  expect(probes[1]).toMatchObject({ registeredTools: [], capabilitySource: 'runtime', runtimeLoaded: false, loadError: 'load failed' })
})

it('uses Pi resource filters without loading or installing an extension', async () => {
  const resolve = vi.fn(async (missing: (source: string) => Promise<string>) => {
    expect(await missing('npm:missing')).toBe('skip')
    return { extensions: [{ path: '/agent/npm/node_modules/example/index.ts', enabled: false, metadata: { source: 'npm:example@1.0.0' } }] }
  })
  const sdk = { SettingsManager: { create: vi.fn(() => ({})) }, DefaultPackageManager: class { resolve = resolve } } as unknown as typeof import('@earendil-works/pi-coding-agent')
  const result = await annotateExtensionInventory(sdk, '/project', '/agent', [{ id: 'example', name: 'example', packageSource: 'npm:example@1.0.0', enabled: true, registeredTools: [], registeredCommands: [] } as unknown as ExtensionProbeResult])
  expect(result[0]).toMatchObject({ enabled: false, capabilitySource: 'static', packageResourcePaths: ['/agent/npm/node_modules/example/index.ts'] })
  expect(resolve).toHaveBeenCalledOnce()
})
