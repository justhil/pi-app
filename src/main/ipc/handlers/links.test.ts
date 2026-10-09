import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { shell } from 'electron'
import { isAllowedIpcChannel } from '@shared/ipc-channels'

const handlers = vi.hoisted(() => new Map<string, (request: unknown) => Promise<unknown>>())
vi.mock('../registry', () => ({
  registerHandlerWithSchema: (channel: string, schema: z.ZodSchema, handler: (request: unknown) => Promise<unknown>) => {
    handlers.set(channel, async (request) => handler(schema.parse(request)))
  },
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../../link-preview', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../link-preview')>(),
  getLinkPreview: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' }),
}))

import { getLinkPreview } from '../../link-preview'
import { registerLinkHandlers } from './links'

beforeEach(() => { vi.clearAllMocks(); handlers.clear(); registerLinkHandlers() })

it('registers allowed, validated preview and external browser handlers', async () => {
  expect(isAllowedIpcChannel('ipc:link.preview')).toBe(true)
  expect(isAllowedIpcChannel('ipc:shell.openExternal')).toBe(true)
  await expect(handlers.get('ipc:link.preview')!({ url: 'https://example.com' })).resolves.toMatchObject({ title: 'Example' })
  await expect(handlers.get('ipc:shell.openExternal')!({ url: 'https://example.com' })).resolves.toEqual({ ok: true })
  expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com')
})

it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com', 'not-a-url'])('rejects invalid destinations before opening or fetching: %s', async (url) => {
  for (const handler of handlers.values()) await expect(handler({ url })).rejects.toThrow()
  expect(shell.openExternal).not.toHaveBeenCalled()
  expect(getLinkPreview).not.toHaveBeenCalled()
})
